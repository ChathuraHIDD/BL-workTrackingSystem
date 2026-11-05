import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Plus, Search, X } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorState, Loading } from '../components/States';
import { ArchivedBadge, OverdueBadge, PriorityBadge, RoleTag, StatusBadge } from '../components/Badges';
import { Pagination } from '../components/Pagination';
import { EmployeeSelect } from '../components/EmployeePicker';
import { listTasks, type ArchivedFilter, type DateField, type SortKey, type StatusFilter, type TaskFilters } from '../lib/api';
import { dueLabel, formatDate, presetRange } from '../lib/dates';
import { useDepartments, useEmployees } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { PRIORITIES, STATUSES, type Priority, type TaskRow } from '../lib/types';

const QUICK_VIEWS = [
  { key: 'all', label: 'All Tasks' },
  { key: 'week', label: 'Due This Week' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
] as const;

function quickViewParams(key: string): Record<string, string> {
  switch (key) {
    case 'week': {
      const r = presetRange('this_week');
      return { view: 'week', status: 'open', df: 'due', from: r.from, to: r.to, sort: 'due_date', dir: 'asc' };
    }
    case 'overdue':
      return { view: 'overdue', overdue: '1', sort: 'due_date', dir: 'asc' };
    case 'in_progress':
      return { view: 'in_progress', status: 'In Progress' };
    case 'completed':
      return { view: 'completed', status: 'Completed', sort: 'completed_at', dir: 'desc' };
    default:
      return {};
  }
}

export function filtersFromParams(p: URLSearchParams): TaskFilters {
  return {
    q: p.get('q') ?? '',
    employeeId: p.get('emp') ?? '',
    employeeRole: (p.get('role') as TaskFilters['employeeRole']) || 'any',
    departmentId: p.get('dept') ? Number(p.get('dept')) : '',
    priority: (p.get('priority') as Priority) || '',
    status: (p.get('status') as StatusFilter) || '',
    overdue: p.get('overdue') === '1',
    dateField: (p.get('df') as DateField) || 'due',
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
    archived: (p.get('archived') as ArchivedFilter) || 'exclude',
  };
}

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'reference_no', label: 'Reference' },
  { key: 'title', label: 'Title' },
  { key: 'primary_employee_name', label: 'Primary employee' },
  { key: null, label: 'Collaborators' },
  { key: 'department_name', label: 'Department' },
  { key: 'priority_rank', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'due_date', label: 'Due date' },
];

export default function TasksPage() {
  const { isStaff, profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const employees = useEmployees();
  const departments = useDepartments();
  const [showFilters, setShowFilters] = useState(false);

  const filters = filtersFromParams(params);
  const view = params.get('view') ?? 'all';
  const sort = (params.get('sort') as SortKey) || 'due_date';
  const asc = (params.get('dir') ?? (sort === 'due_date' ? 'asc' : 'desc')) === 'asc';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const pageSize = Number(params.get('size') ?? 25);

  // debounced search box
  const [search, setSearch] = useState(filters.q ?? '');
  const lastPushed = useRef(filters.q ?? '');
  useEffect(() => {
    const q = params.get('q') ?? '';
    if (q !== lastPushed.current) {
      lastPushed.current = q;
      setSearch(q);
    }
  }, [params]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== lastPushed.current) {
        lastPushed.current = search;
        update({ q: search });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage && !('page' in changes)) next.delete('page');
    if (!('view' in changes) && Object.keys(changes).some((k) => !['page', 'size', 'sort', 'dir'].includes(k))) next.delete('view');
    setParams(next, { replace: true });
  }

  const query = useQuery({
    queryKey: ['tasks', filters, sort, asc, page, pageSize],
    queryFn: () => listTasks(filters, { sort, asc, page, pageSize }),
    placeholderData: keepPreviousData,
  });

  const activeFilterCount = [
    filters.employeeId,
    filters.departmentId,
    filters.priority,
    filters.status && view === 'all' ? filters.status : '',
    filters.overdue && view !== 'overdue',
    filters.from || filters.to,
    filters.archived !== 'exclude',
  ].filter(Boolean).length;

  function sortBy(key: SortKey) {
    if (sort === key) update({ dir: asc ? 'desc' : 'asc' }, false);
    else update({ sort: key, dir: key === 'due_date' || key === 'priority_rank' || key === 'reference_no' ? 'asc' : 'desc' }, false);
  }

  const myId = profile?.employee?.id;

  return (
    <div className="page">
      <PageHeader
        title={isStaff ? 'All Work Records' : 'My Tasks'}
        subtitle={isStaff ? 'Every work record across the company.' : 'Tasks where you are the primary employee or a collaborator.'}
        actions={
          isStaff && (
            <Link to="/tasks/new" className="btn btn-primary">
              <Plus size={18} aria-hidden /> New task
            </Link>
          )
        }
      />

      <div className="tabs" role="tablist" aria-label="Quick views">
        {QUICK_VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={`tab ${view === v.key ? 'tab-active' : ''}`}
            onClick={() => setParams(new URLSearchParams(quickViewParams(v.key)), { replace: true })}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search-input grow">
          <Search size={16} aria-hidden />
          <input
            type="search"
            placeholder="Search title, reference, description or employee…"
            aria-label="Search tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-secondary" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="task-filters">
          <Filter size={16} aria-hidden /> Filters{activeFilterCount > 0 && <span className="count-pill">{activeFilterCount}</span>}
        </button>
        {(activeFilterCount > 0 || filters.q || view !== 'all') && (
          <button className="btn btn-link" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            <X size={14} aria-hidden /> Clear all
          </button>
        )}
      </div>

      {showFilters && (
        <div id="task-filters" className="card filter-panel">
          <div className="filter-grid">
            {isStaff && (
              <div className="field">
                <label htmlFor="f-emp">Employee</label>
                <EmployeeSelect
                  id="f-emp"
                  employees={employees.data ?? []}
                  value={filters.employeeId ?? ''}
                  onChange={(v) => update({ emp: v })}
                  placeholder="Any employee"
                  includeInactive
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="f-role">Involvement</label>
              <select
                id="f-role"
                value={filters.employeeRole}
                onChange={(e) => update({ role: e.target.value === 'any' ? null : e.target.value, emp: filters.employeeId || (isStaff ? null : myId ?? null) })}
              >
                <option value="any">Primary or collaborator</option>
                <option value="primary">Primary only</option>
                <option value="collaborator">Collaborator only</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-dept">Department</label>
              <select id="f-dept" value={filters.departmentId} onChange={(e) => update({ dept: e.target.value })}>
                <option value="">Any department</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-pri">Priority</label>
              <select id="f-pri" value={filters.priority} onChange={(e) => update({ priority: e.target.value })}>
                <option value="">Any priority</option>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-status">Status</label>
              <select id="f-status" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
                <option value="">Any status</option>
                <option value="open">All open (not completed)</option>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-arch">Archived</label>
              <select id="f-arch" value={filters.archived} onChange={(e) => update({ archived: e.target.value === 'exclude' ? null : e.target.value })}>
                <option value="exclude">Hide archived</option>
                <option value="include">Include archived</option>
                <option value="only">Archived only</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-df">Date range applies to</label>
              <select id="f-df" value={filters.dateField} onChange={(e) => update({ df: e.target.value === 'due' ? null : e.target.value })}>
                <option value="due">Due date</option>
                <option value="completed">Completion date</option>
                <option value="created">Created date</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input id="f-from" type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="f-to">To</label>
              <input id="f-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
            </div>
            <div className="field checkbox-field">
              <label>
                <input type="checkbox" checked={filters.overdue} onChange={(e) => update({ overdue: e.target.checked ? '1' : null })} /> Overdue only
              </label>
            </div>
          </div>
        </div>
      )}

      <section className="card table-card" aria-live="polite" aria-busy={query.isFetching}>
        {query.isLoading && <Loading />}
        {query.error && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {query.data && query.data.rows.length === 0 && (
          <Empty title="No work records match">
            {activeFilterCount || filters.q ? 'Try changing the search or filters.' : isStaff ? 'Create the first task to get started.' : 'You have no assignments yet.'}
          </Empty>
        )}
        {query.data && query.data.rows.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table responsive-table">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.label}
                        scope="col"
                        aria-sort={c.key && sort === c.key ? (asc ? 'ascending' : 'descending') : undefined}
                      >
                        {c.key ? (
                          <button className="sort-btn" onClick={() => sortBy(c.key!)}>
                            {c.label}
                            {sort === c.key ? (asc ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} className="faint" />}
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((t) => (
                    <TaskTableRow key={t.id} t={t} myId={myId} onOpen={() => navigate(`/tasks/${t.id}`)} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={query.data.total}
              onPage={(p) => update({ page: String(p) }, false)}
              onPageSize={(s) => update({ size: String(s) })}
            />
          </>
        )}
      </section>
    </div>
  );
}

function TaskTableRow({ t, myId, onOpen }: { t: TaskRow; myId?: string; onOpen: () => void }) {
  const mine = myId && (t.primary_employee_id === myId || t.collaborator_ids.includes(myId));
  return (
    <tr className={`clickable ${t.is_overdue ? 'row-overdue' : ''}`} onClick={onOpen}>
      <td data-label="Reference">
        <Link to={`/tasks/${t.id}`} className="ref" onClick={(e) => e.stopPropagation()}>
          {t.reference_no}
        </Link>
      </td>
      <td data-label="Title" className="cell-title">
        <span className="title-text">{t.title}</span>
        {t.is_archived && <ArchivedBadge />}
        {mine && <RoleTag role={t.primary_employee_id === myId ? 'primary' : 'collaborator'} />}
      </td>
      <td data-label="Primary">
        <span className="primary-name">{t.primary_employee_name}</span>
        {!t.primary_employee_active && <span className="muted small"> (inactive)</span>}
      </td>
      <td data-label="Collaborators" className="muted">
        {t.collaborator_names.length ? t.collaborator_names.join(', ') : '—'}
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
      <td data-label="Due date" className="nowrap">
        <div>{formatDate(t.due_date)}</div>
        {t.status !== 'Completed' && <div className={`small ${t.is_overdue ? 'overdue-text' : 'muted'}`}>{dueLabel(t.due_date, false)}</div>}
      </td>
    </tr>
  );
}
