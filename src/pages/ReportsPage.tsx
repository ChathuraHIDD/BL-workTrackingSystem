import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, CheckCircle2, Download, FileSpreadsheet, Users } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorState, Loading } from '../components/States';
import { OverdueBadge, PriorityBadge, StatusBadge } from '../components/Badges';
import { DateRangeFields } from '../components/DateRangeFields';
import { EmployeeSelect } from '../components/EmployeePicker';
import { fetchAllTasks, type ArchivedFilter, type StatusFilter, type TaskFilters } from '../lib/api';
import { formatDate, formatDateTime, presetRange, type DateRange } from '../lib/dates';
import { useDepartments, useEmployees } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { exportReport, type ExportFormat } from '../lib/exporter';
import {
  assignmentRows,
  buildWorkload,
  TASK_EXPORT_HEADERS as TASK_HEADERS,
  taskExportRows,
  totalsExportRows,
  workloadExportRows,
} from '../lib/reports';
import { friendlyError } from '../lib/errors';
import { PRIORITIES, STATUSES, type Priority, type TaskRow } from '../lib/types';

type ReportKind = 'due' | 'completed' | 'workload';


export default function ReportsPage() {
  const [kind, setKind] = useState<ReportKind>('due');
  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle="Exports reflect exactly the filters you select. Dates use Asia/Colombo time; ranges are inclusive and weeks run Monday–Sunday."
      />
      <div className="report-picker" role="tablist" aria-label="Report type">
        <ReportTab active={kind === 'due'} onClick={() => setKind('due')} icon={<CalendarRange size={20} />} title="Tasks due in a date range" text="Filtered by each task's due date." />
        <ReportTab active={kind === 'completed'} onClick={() => setKind('completed')} icon={<CheckCircle2 size={20} />} title="Tasks completed in a date range" text="Filtered by the actual completion time." />
        <ReportTab active={kind === 'workload'} onClick={() => setKind('workload')} icon={<Users size={20} />} title="Employee workload & completion" text="Primary vs collaborative work per employee." />
      </div>
      {kind === 'workload' ? <WorkloadReport /> : <TaskRangeReport key={kind} kind={kind} />}
    </div>
  );
}

function ReportTab({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <button role="tab" aria-selected={active} className={`report-tab ${active ? 'report-tab-active' : ''}`} onClick={onClick}>
      <span className="report-ico" aria-hidden>
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <span className="muted small">{text}</span>
      </span>
    </button>
  );
}

interface CommonFilters {
  employeeId: string;
  departmentId: string;
  priority: Priority | '';
  status: StatusFilter;
  archived: ArchivedFilter;
}

function CommonFilterFields({
  f,
  setF,
  showStatus = true,
  departmentLabel = 'Department',
}: {
  f: CommonFilters;
  setF: (f: CommonFilters) => void;
  showStatus?: boolean;
  departmentLabel?: string;
}) {
  const { isStaff } = useAuth();
  const employees = useEmployees();
  const departments = useDepartments();
  return (
    <div className="filter-grid">
      {isStaff && (
        <div className="field">
          <label htmlFor="r-emp">Employee</label>
          <EmployeeSelect id="r-emp" employees={employees.data ?? []} value={f.employeeId} onChange={(v) => setF({ ...f, employeeId: v })} placeholder="All employees" includeInactive />
        </div>
      )}
      {isStaff && (
        <div className="field">
          <label htmlFor="r-dept">{departmentLabel}</label>
          <select id="r-dept" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
            <option value="">All departments</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="r-pri">Priority</label>
        <select id="r-pri" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority | '' })}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      {showStatus && (
        <div className="field">
          <label htmlFor="r-status">Status</label>
          <select id="r-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StatusFilter })}>
            <option value="">All statuses</option>
            <option value="open">All open (not completed)</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="r-arch">Archived tasks</label>
        <select id="r-arch" value={f.archived} onChange={(e) => setF({ ...f, archived: e.target.value as ArchivedFilter })}>
          <option value="exclude">Exclude</option>
          <option value="include">Include</option>
        </select>
      </div>
    </div>
  );
}

const initialCommon: CommonFilters = { employeeId: '', departmentId: '', priority: '', status: '', archived: 'exclude' };

function ExportButtons({ disabled, onExport, busy }: { disabled: boolean; busy: boolean; onExport: (f: ExportFormat) => void }) {
  return (
    <div className="row gap-sm wrap">
      <button className="btn btn-primary" disabled={disabled || busy} onClick={() => onExport('xlsx')}>
        <FileSpreadsheet size={16} aria-hidden /> {busy ? 'Preparing…' : 'Download Excel (.xlsx)'}
      </button>
      <button className="btn btn-secondary" disabled={disabled || busy} onClick={() => onExport('csv')}>
        <Download size={16} aria-hidden /> Download CSV
      </button>
    </div>
  );
}

function isRangeValid(r: DateRange) {
  return !!r.from && !!r.to && r.from <= r.to;
}

// ---------------------------------------------------------------------------
// Report 1 & 2 — tasks due / completed within a range
// ---------------------------------------------------------------------------
function TaskRangeReport({ kind }: { kind: 'due' | 'completed' }) {
  const notify = useToast();
  const departments = useDepartments();
  const employees = useEmployees();
  const [range, setRange] = useState<DateRange>(presetRange(kind === 'due' ? 'this_week' : 'this_month'));
  const [f, setF] = useState<CommonFilters>(initialCommon);
  const [busy, setBusy] = useState(false);
  const valid = isRangeValid(range);

  const filters: TaskFilters = {
    dateField: kind === 'due' ? 'due' : 'completed',
    from: range.from,
    to: range.to,
    employeeId: f.employeeId,
    departmentId: f.departmentId ? Number(f.departmentId) : '',
    priority: f.priority,
    status: kind === 'completed' ? '' : f.status,
    archived: f.archived,
  };
  const q = useQuery({
    queryKey: ['report', kind, filters],
    queryFn: () => fetchAllTasks(filters, kind === 'due' ? 'due_date' : 'completed_at'),
    enabled: valid,
  });

  async function onExport(format: ExportFormat) {
    if (!q.data) return;
    setBusy(true);
    try {
      const deptName = departments.data?.find((d) => String(d.id) === f.departmentId)?.name;
      const empName = employees.data?.find((e) => e.id === f.employeeId)?.full_name;
      await exportReport({
        baseName: kind === 'due' ? `Tasks_Due_${range.from}_to_${range.to}` : `Tasks_Completed_${range.from}_to_${range.to}`,
        format,
        sheets: [{ name: kind === 'due' ? 'Tasks Due' : 'Tasks Completed', rows: taskExportRows(q.data), headers: TASK_HEADERS }],
        info: [
          ['Report', kind === 'due' ? 'Tasks due within a date range' : 'Tasks completed within a date range'],
          [kind === 'due' ? 'Due date range' : 'Completion date range', `${range.from} to ${range.to} (inclusive)`],
          ['Employee', empName ? `${empName} (primary or collaborator)` : 'All'],
          ['Department', deptName ?? 'All'],
          ['Priority', f.priority || 'All'],
          ...(kind === 'due' ? ([['Status', f.status === 'open' ? 'All open' : f.status || 'All']] as [string, string][]) : []),
          ['Archived tasks', f.archived === 'include' ? 'Included' : 'Excluded'],
          ['Records', String(q.data.length)],
        ],
      });
      notify(`Exported ${q.data.length} task${q.data.length === 1 ? '' : 's'}.`);
    } catch (err) {
      notify(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <DateRangeFields
          value={range}
          onChange={setRange}
          legend={kind === 'due' ? 'Due date range' : 'Completion date range'}
          presets={kind === 'due' ? ['this_week', 'next_week', 'this_month', 'next_month', 'last_week'] : ['this_week', 'last_week', 'this_month', 'last_month', 'last_30_days']}
        />
        <CommonFilterFields f={f} setF={setF} showStatus={kind === 'due'} departmentLabel="Department (primary employee's)" />
        {kind === 'completed' && <p className="hint">Includes every task completed in the range, regardless of its original due date.</p>}
        <div className="report-actions">
          <span className="muted" aria-live="polite">
            {!valid ? 'Choose a valid date range.' : q.isFetching ? 'Counting…' : q.data ? `${q.data.length} matching task${q.data.length === 1 ? '' : 's'}` : ''}
          </span>
          <ExportButtons disabled={!valid || !q.data} busy={busy} onExport={onExport} />
        </div>
      </section>
      <section className="card table-card">
        <h2 className="card-title pad">Preview</h2>
        {q.isLoading && <Loading />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && q.data.length === 0 && <Empty title="No tasks match these filters" />}
        {q.data && q.data.length > 0 && <TaskPreview rows={q.data} kind={kind} />}
      </section>
    </>
  );
}

function TaskPreview({ rows, kind }: { rows: TaskRow[]; kind: 'due' | 'completed' }) {
  const shown = rows.slice(0, 50);
  return (
    <>
      <div className="table-wrap">
        <table className="table responsive-table">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Title</th>
              <th scope="col">Primary employee</th>
              <th scope="col">Collaborators</th>
              <th scope="col">Department</th>
              <th scope="col">Priority</th>
              <th scope="col">Status</th>
              <th scope="col">Due</th>
              {kind === 'completed' && <th scope="col">Completed</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id}>
                <td data-label="Reference">
                  <Link to={`/tasks/${t.id}`} className="ref">
                    {t.reference_no}
                  </Link>
                </td>
                <td data-label="Title">{t.title}</td>
                <td data-label="Primary">{t.primary_employee_name}</td>
                <td data-label="Collaborators" className="muted">
                  {t.collaborator_names.join(', ') || '—'}
                </td>
                <td data-label="Department">{t.department_name}</td>
                <td data-label="Priority">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td data-label="Status">
                  <div className="badge-stack">
                    <StatusBadge status={t.status} />
                    {t.is_overdue && <OverdueBadge />}
                  </div>
                </td>
                <td data-label="Due">{formatDate(t.due_date)}</td>
                {kind === 'completed' && <td data-label="Completed">{formatDateTime(t.completed_at)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && <p className="muted small pad">Showing first {shown.length} of {rows.length}. The download includes all rows.</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Report 3 — employee workload & completion summary
// ---------------------------------------------------------------------------
function WorkloadReport() {
  const { isStaff, profile } = useAuth();
  const notify = useToast();
  const employees = useEmployees();
  const departments = useDepartments();
  const [basis, setBasis] = useState<'due' | 'completed' | 'none'>('due');
  const [range, setRange] = useState<DateRange>(presetRange('this_month'));
  const [f, setF] = useState<CommonFilters>(() => ({ ...initialCommon, employeeId: isStaff ? '' : (profile?.employee?.id ?? '') }));
  const [busy, setBusy] = useState(false);
  const valid = basis === 'none' || isRangeValid(range);

  const filters: TaskFilters = {
    dateField: basis === 'completed' ? 'completed' : 'due',
    from: basis === 'none' ? '' : range.from,
    to: basis === 'none' ? '' : range.to,
    employeeId: f.employeeId,
    priority: f.priority,
    status: f.status,
    archived: f.archived,
  };
  const q = useQuery({ queryKey: ['report', 'workload', filters], queryFn: () => fetchAllTasks(filters), enabled: valid && !!employees.data });

  const inScope = useMemo(() => {
    const emp = new Map((employees.data ?? []).map((e) => [e.id, e]));
    return (id: string) => {
      if (f.employeeId && id !== f.employeeId) return false;
      if (f.departmentId && String(emp.get(id)?.department_id) !== f.departmentId) return false;
      return true;
    };
  }, [employees.data, f.employeeId, f.departmentId]);

  const result = useMemo(() => {
    if (!q.data || !employees.data) return null;
    const scopedEmployees = isStaff ? employees.data : employees.data.filter((e) => e.id === profile?.employee?.id);
    const tasks = q.data.filter((t) => inScope(t.primary_employee_id) || t.collaborator_ids.some(inScope));
    return { tasks, ...buildWorkload(tasks, scopedEmployees, inScope) };
  }, [q.data, employees.data, inScope, isStaff, profile]);

  async function onExport(format: ExportFormat) {
    if (!result) return;
    setBusy(true);
    try {
      const deptName = departments.data?.find((d) => String(d.id) === f.departmentId)?.name;
      const empName = employees.data?.find((e) => e.id === f.employeeId)?.full_name;
      await exportReport({
        baseName: 'Employee_Workload_Summary',
        format,
        sheets: [
          { name: 'By Employee', rows: workloadExportRows(result.rows) },
          { name: 'Company Totals', rows: totalsExportRows(result.totals) },
          { name: 'Tasks (each once)', rows: taskExportRows(result.tasks), headers: TASK_HEADERS },
          { name: 'Assignments by Employee', rows: assignmentRows(result.tasks, inScope) },
        ],
        info: [
          ['Report', 'Employee workload and completion summary'],
          ['Date basis', basis === 'none' ? 'All dates' : basis === 'due' ? 'Due date' : 'Completion date'],
          ...(basis === 'none' ? [] : ([['Date range', `${range.from} to ${range.to} (inclusive)`]] as [string, string][])),
          ['Employee', empName ?? 'All'],
          ['Department (employee)', deptName ?? 'All'],
          ['Priority', f.priority || 'All'],
          ['Status', f.status === 'open' ? 'All open' : f.status || 'All'],
          ['Archived tasks', f.archived === 'include' ? 'Included' : 'Excluded'],
          [
            'Counting rule',
            'Per-employee rows count primary and collaborative work separately. Company totals count each task once, so they are not the sum of employee rows.',
          ],
        ],
      });
      notify('Workload summary downloaded.');
    } catch (err) {
      notify(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <div className="field basis-field">
          <label htmlFor="w-basis">Date filter based on</label>
          <select id="w-basis" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
            <option value="due">Due date</option>
            <option value="completed">Completion date</option>
            <option value="none">All dates (no date filter)</option>
          </select>
        </div>
        {basis !== 'none' && (
          <DateRangeFields value={range} onChange={setRange} legend="Date range" presets={['this_week', 'next_week', 'last_week', 'this_month', 'last_month']} />
        )}
        <CommonFilterFields f={f} setF={setF} departmentLabel="Employee department" />
        <div className="report-actions">
          <span className="muted small">CSV contains the per-employee summary; Excel adds company totals, task detail and assignment sheets.</span>
          <ExportButtons disabled={!valid || !result} busy={busy} onExport={onExport} />
        </div>
      </section>

      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {result && (
        <>
          <section className="metrics" aria-label="Company totals (each task counted once)">
            <div className="metric metric-slate">
              <div className="metric-top">Distinct tasks</div>
              <strong className="metric-value">{result.totals.distinctTasks}</strong>
              <span className="metric-hint">each task counted once</span>
            </div>
            <div className="metric metric-blue">
              <div className="metric-top">Open</div>
              <strong className="metric-value">{result.totals.open}</strong>
              <span className="metric-hint">{result.totals.inProgress} in progress</span>
            </div>
            <div className="metric metric-red">
              <div className="metric-top">Overdue</div>
              <strong className="metric-value">{result.totals.overdue}</strong>
            </div>
            <div className="metric metric-green">
              <div className="metric-top">Completed</div>
              <strong className="metric-value">{result.totals.completed}</strong>
              <span className="metric-hint">
                {result.totals.completedOnTime} on time · {result.totals.completedLate} late
              </span>
            </div>
          </section>
          <section className="card table-card">
            <h2 className="card-title pad">By employee</h2>
            {result.rows.length === 0 ? (
              <Empty title="No employees match these filters" />
            ) : (
              <div className="table-wrap">
                <table className="table responsive-table numeric">
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col">Department</th>
                      <th scope="col">Primary</th>
                      <th scope="col">Collaborator</th>
                      <th scope="col">Open (P / C)</th>
                      <th scope="col">Overdue (P / C)</th>
                      <th scope="col">Completed (P / C)</th>
                      <th scope="col">Primary on time / late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.employeeId}>
                        <td data-label="Employee">
                          <Link to={`/employees/${r.employeeId}`}>{r.name}</Link>
                          {!r.isActive && <span className="muted small"> (inactive)</span>}
                        </td>
                        <td data-label="Department">{r.department}</td>
                        <td data-label="Primary">{r.primaryTotal}</td>
                        <td data-label="Collaborator">{r.collaboratorTotal}</td>
                        <td data-label="Open (P / C)">
                          {r.primaryOpen} / {r.collaboratorOpen}
                        </td>
                        <td data-label="Overdue (P / C)" className={r.primaryOverdue + r.collaboratorOverdue ? 'overdue-text' : ''}>
                          {r.primaryOverdue} / {r.collaboratorOverdue}
                        </td>
                        <td data-label="Completed (P / C)">
                          {r.primaryCompleted} / {r.collaboratorCompleted}
                        </td>
                        <td data-label="On time / late">
                          {r.completedOnTime} / {r.completedLate}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small pad">P = primary responsible, C = collaborator. Company totals above count each task once.</p>
          </section>
        </>
      )}
    </>
  );
}
