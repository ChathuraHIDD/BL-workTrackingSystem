import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Mail, Pencil, UserX, UserCheck } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorState, Loading } from '../components/States';
import { ActiveBadge, OverdueBadge, PriorityBadge, RoleTag, StatusBadge } from '../components/Badges';
import { DateRangeFields } from '../components/DateRangeFields';
import { EmployeeFormModal, ToggleActiveDialog } from './EmployeesPage';
import { fetchAllTasks, getEmployee } from '../lib/api';
import { addDays, dueLabel, formatDate, formatDateTime, formatDateTimeISO, todayISO, type DateRange } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { exportReport, type ExportFormat } from '../lib/exporter';
import { taskExportRows } from '../lib/reports';
import { friendlyError } from '../lib/errors';
import type { Employee, TaskRow } from '../lib/types';

type Tab = 'active' | 'upcoming' | 'overdue' | 'completed';
type RoleFilter = 'all' | 'primary' | 'collaborator';

export default function EmployeeProfilePage() {
  const { id = '' } = useParams();
  const { isStaff, profile } = useAuth();
  const isSelf = profile?.employee?.id === id;
  const employee = useQuery({ queryKey: ['employee', id], queryFn: () => getEmployee(id), enabled: isStaff || isSelf });

  if (!isStaff && !isSelf) return <Navigate to="/" replace />;
  if (employee.isLoading) return <Loading />;
  if (employee.error) return <ErrorState error={employee.error} onRetry={() => employee.refetch()} />;
  if (!employee.data) return <Empty title="Employee not found" />;
  return <Profile e={employee.data} isSelf={isSelf} />;
}

function completedDate(t: TaskRow) {
  return t.completed_at ? formatDateTimeISO(t.completed_at).slice(0, 10) : '';
}

function Profile({ e, isSelf }: { e: Employee; isSelf: boolean }) {
  const { isStaff, isAdmin } = useAuth();
  const notify = useToast();
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [role, setRole] = useState<RoleFilter>('all');
  const [tab, setTab] = useState<Tab>('active');
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [exporting, setExporting] = useState(false);

  const tasks = useQuery({
    queryKey: ['employee-tasks', e.id],
    queryFn: () => fetchAllTasks({ employeeId: e.id }),
  });

  const today = todayISO();
  const view = useMemo(() => {
    const all = (tasks.data ?? []).filter((t) => {
      const isPrimary = t.primary_employee_id === e.id;
      return role === 'all' || (role === 'primary' ? isPrimary : !isPrimary);
    });
    const inDue = (t: TaskRow) => (!range.from || t.due_date >= range.from) && (!range.to || t.due_date <= range.to);
    const inDone = (t: TaskRow) => {
      const d = completedDate(t);
      return (!range.from || d >= range.from) && (!range.to || d <= range.to);
    };
    const open = all.filter((t) => t.status !== 'Completed' && inDue(t));
    const completed = all
      .filter((t) => t.status === 'Completed' && inDone(t))
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    const overdue = open.filter((t) => t.is_overdue);
    const upcoming = open.filter((t) => !t.is_overdue && t.due_date <= addDays(today, 14));
    const scoped = [...open, ...completed];
    return {
      open,
      completed,
      overdue,
      upcoming,
      total: scoped.length,
      primary: scoped.filter((t) => t.primary_employee_id === e.id).length,
      collaborator: scoped.filter((t) => t.primary_employee_id !== e.id).length,
    };
  }, [tasks.data, range, role, e.id, today]);

  const lists: Record<Tab, TaskRow[]> = {
    active: view.open,
    upcoming: view.upcoming,
    overdue: view.overdue,
    completed: view.completed,
  };

  async function download(kind: 'workload' | 'completion', format: ExportFormat) {
    setExporting(true);
    try {
      const withRole = (list: TaskRow[]) =>
        taskExportRows(list).map((r, i) => ({ 'Employee Role': list[i].primary_employee_id === e.id ? 'Primary' : 'Collaborator', ...r }));
      const rangeText = range.from || range.to ? `${range.from || 'any'} to ${range.to || 'any'}` : 'All dates';
      const summary = [
        { Metric: 'Employee', Value: e.full_name },
        { Metric: 'Department', Value: e.department_name },
        { Metric: 'Total assignments in scope', Value: view.total },
        { Metric: '  as Primary', Value: view.primary },
        { Metric: '  as Collaborator', Value: view.collaborator },
        { Metric: 'Ongoing (open)', Value: view.open.length },
        { Metric: 'Overdue', Value: view.overdue.length },
        { Metric: 'Completed', Value: view.completed.length },
      ];
      const info: [string, string][] = [
        ['Report', kind === 'workload' ? 'Employee workload summary' : 'Employee completion summary'],
        ['Employee', `${e.full_name} (${e.department_name})`],
        ['Involvement', role === 'all' ? 'Primary and collaborator' : role === 'primary' ? 'Primary only' : 'Collaborator only'],
        ['Date range', `${rangeText} (${kind === 'workload' ? 'by due date' : 'by completion date'})`],
      ];
      const slug = e.full_name.replace(/\s+/g, '_');
      if (kind === 'workload') {
        await exportReport({
          baseName: `Workload_${slug}`,
          format,
          info,
          sheets: [
            { name: 'Open Work', rows: withRole(view.open) },
            { name: 'Summary', rows: summary },
          ],
        });
      } else {
        await exportReport({
          baseName: `Completed_Work_${slug}`,
          format,
          info,
          sheets: [
            { name: 'Completed Work', rows: withRole(view.completed) },
            { name: 'Summary', rows: summary },
          ],
        });
      }
      notify('Download ready.');
    } catch (err) {
      notify(friendlyError(err), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page">
      {isStaff && (
        <Link to="/employees" className="back-link">
          <ArrowLeft size={16} aria-hidden /> Employees
        </Link>
      )}
      <PageHeader
        title={isSelf ? 'My Workload' : e.full_name}
        subtitle={
          <span className="row gap-sm wrap">
            {isSelf && <strong>{e.full_name}</strong>}
            <span>{e.job_title ?? 'No job title'}</span>
            <span aria-hidden>·</span>
            <span>{e.department_name}</span>
            <ActiveBadge active={e.is_active} />
          </span>
        }
        actions={
          isAdmin && (
            <>
              <button className="btn btn-secondary" onClick={() => setEditing(true)}>
                <Pencil size={16} aria-hidden /> Edit
              </button>
              <button className="btn btn-secondary" onClick={() => setToggling(true)}>
                {e.is_active ? <UserX size={16} aria-hidden /> : <UserCheck size={16} aria-hidden />}
                {e.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </>
          )
        }
      />
      <p className="muted row gap-sm">
        <Mail size={15} aria-hidden /> <a href={`mailto:${e.email}`}>{e.email}</a>
        {!e.is_active && e.deactivated_at && <span>· Deactivated {formatDateTime(e.deactivated_at)}</span>}
      </p>

      <section className="card filter-panel">
        <div className="profile-filters">
          <DateRangeFields
            value={range}
            onChange={setRange}
            presets={['this_week', 'next_week', 'this_month', 'last_month']}
            legend="Date range (open work by due date, completed work by completion date)"
          />
          <div className="field">
            <label htmlFor="pf-role">Involvement</label>
            <select id="pf-role" value={role} onChange={(ev) => setRole(ev.target.value as RoleFilter)}>
              <option value="all">Primary and collaborator</option>
              <option value="primary">Primary only</option>
              <option value="collaborator">Collaborator only</option>
            </select>
            {(range.from || range.to) && (
              <button className="btn btn-link btn-sm" onClick={() => setRange({ from: '', to: '' })}>
                Clear dates
              </button>
            )}
          </div>
        </div>
      </section>

      {tasks.isLoading && <Loading />}
      {tasks.error && <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />}
      {tasks.data && (
        <>
          <section className="metrics metrics-4" aria-label="Summary counts">
            <div className="metric metric-slate">
              <div className="metric-top">Total assignments</div>
              <strong className="metric-value">{view.total}</strong>
              <span className="metric-hint">
                {view.primary} primary · {view.collaborator} collaborator
              </span>
            </div>
            <button className="metric metric-blue" onClick={() => setTab('active')}>
              <div className="metric-top">Ongoing work</div>
              <strong className="metric-value">{view.open.length}</strong>
            </button>
            <button className="metric metric-red" onClick={() => setTab('overdue')}>
              <div className="metric-top">Overdue</div>
              <strong className="metric-value">{view.overdue.length}</strong>
            </button>
            <button className="metric metric-green" onClick={() => setTab('completed')}>
              <div className="metric-top">Completed</div>
              <strong className="metric-value">{view.completed.length}</strong>
            </button>
          </section>

          <div className="row between wrap gap-sm export-row">
            <div className="row gap-sm wrap">
              <span className="label">Workload summary:</span>
              <button className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => download('workload', 'xlsx')}>
                <Download size={14} aria-hidden /> Excel
              </button>
              <button className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => download('workload', 'csv')}>
                <Download size={14} aria-hidden /> CSV
              </button>
            </div>
            <div className="row gap-sm wrap">
              <span className="label">Completion summary:</span>
              <button className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => download('completion', 'xlsx')}>
                <Download size={14} aria-hidden /> Excel
              </button>
              <button className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => download('completion', 'csv')}>
                <Download size={14} aria-hidden /> CSV
              </button>
            </div>
          </div>

          <section className="card table-card">
            <div className="tabs" role="tablist" aria-label="Task lists">
              {(
                [
                  ['active', `Active (${view.open.length})`],
                  ['upcoming', `Upcoming 14 days (${view.upcoming.length})`],
                  ['overdue', `Overdue (${view.overdue.length})`],
                  ['completed', `Completed work (${view.completed.length})`],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'tab-active' : ''}`} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            {tab === 'completed' ? <CompletedTable rows={lists.completed} employeeId={e.id} /> : <OpenTable rows={lists[tab]} employeeId={e.id} />}
          </section>
        </>
      )}

      {editing && <EmployeeFormModal employee={e} onClose={() => setEditing(false)} />}
      {toggling && <ToggleActiveDialog employee={e} onClose={() => setToggling(false)} />}
    </div>
  );
}

function OpenTable({ rows, employeeId }: { rows: TaskRow[]; employeeId: string }) {
  if (!rows.length) return <Empty title="Nothing here" />;
  return (
    <div className="table-wrap">
      <table className="table responsive-table">
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Title</th>
            <th scope="col">Role</th>
            <th scope="col">Primary employee</th>
            <th scope="col">Priority</th>
            <th scope="col">Status</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={t.is_overdue ? 'row-overdue' : ''}>
              <td data-label="Reference">
                <Link to={`/tasks/${t.id}`} className="ref">
                  {t.reference_no}
                </Link>
              </td>
              <td data-label="Title">{t.title}</td>
              <td data-label="Role">
                <RoleTag role={t.primary_employee_id === employeeId ? 'primary' : 'collaborator'} />
              </td>
              <td data-label="Primary">{t.primary_employee_name}</td>
              <td data-label="Priority">
                <PriorityBadge priority={t.priority} />
              </td>
              <td data-label="Status">
                <div className="badge-stack">
                  <StatusBadge status={t.status} />
                  {t.is_overdue && <OverdueBadge />}
                </div>
              </td>
              <td data-label="Due" className="nowrap">
                {formatDate(t.due_date)}
                <div className={`small ${t.is_overdue ? 'overdue-text' : 'muted'}`}>{dueLabel(t.due_date, false)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompletedTable({ rows, employeeId }: { rows: TaskRow[]; employeeId: string }) {
  if (!rows.length) return <Empty title="No completed work in this period" />;
  return (
    <div className="table-wrap">
      <table className="table responsive-table">
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Title</th>
            <th scope="col">Role</th>
            <th scope="col">Due date</th>
            <th scope="col">Completed</th>
            <th scope="col">Timeliness</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const late = completedDate(t) > t.due_date;
            return (
              <tr key={t.id}>
                <td data-label="Reference">
                  <Link to={`/tasks/${t.id}`} className="ref">
                    {t.reference_no}
                  </Link>
                </td>
                <td data-label="Title">{t.title}</td>
                <td data-label="Role">
                  <RoleTag role={t.primary_employee_id === employeeId ? 'primary' : 'collaborator'} />
                </td>
                <td data-label="Due date">{formatDate(t.due_date)}</td>
                <td data-label="Completed">{formatDateTime(t.completed_at)}</td>
                <td data-label="Timeliness">
                  <span className={`badge ${late ? 'st-hold' : 'st-done'}`}>{late ? 'Late' : 'On time'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
