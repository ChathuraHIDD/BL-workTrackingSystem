import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Loader, Plus } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { ErrorState, Empty, Loading } from '../components/States';
import { PriorityBadge, RoleTag } from '../components/Badges';
import { dashboardSummary, listTasks, recentActivity } from '../lib/api';
import { PRESET_LABELS, dueLabel, formatDate, presetRange, relativeTime, type PresetKey } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useDepartments } from '../lib/hooks';
import { describeActivity } from '../lib/activity';
import type { DashboardSummary } from '../lib/types';

const PERIODS: PresetKey[] = ['this_week', 'last_week', 'this_month', 'last_month', 'last_30_days'];

export default function DashboardPage() {
  const { profile, isStaff } = useAuth();
  const [period, setPeriod] = useState<PresetKey>('this_month');
  const range = presetRange(period);

  const summary = useQuery({
    queryKey: ['dashboard', range.from, range.to],
    queryFn: () => dashboardSummary(range.from, range.to),
    refetchInterval: 120_000,
  });
  const upcoming = useQuery({
    queryKey: ['upcoming'],
    queryFn: () =>
      listTasks({ status: 'open', dateField: 'due', from: summary.data?.today }, { sort: 'due_date', asc: true, page: 1, pageSize: 8 }),
    enabled: !!summary.data,
  });
  const activity = useQuery({ queryKey: ['recent-activity'], queryFn: () => recentActivity(12) });

  const firstName = profile?.employee?.full_name.split(' ')[0];

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={`${firstName ? `Welcome back, ${firstName}. ` : ''}${isStaff ? 'Company-wide workload at a glance.' : 'Your assignments at a glance.'}`}
        actions={
          isStaff && (
            <Link to="/tasks/new" className="btn btn-primary">
              <Plus size={18} aria-hidden /> New task
            </Link>
          )
        }
      />

      {summary.isLoading && <Loading />}
      {summary.error && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      {summary.data && (
        <>
          <MetricGrid s={summary.data} range={range} period={period} setPeriod={setPeriod} />
          {isStaff && <Distribution s={summary.data} />}
        </>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="upcoming-h">
          <div className="card-header">
            <h2 id="upcoming-h">
              <CalendarClock size={18} aria-hidden /> Upcoming deadlines
            </h2>
            <Link to="/tasks?status=open&sort=due_date&dir=asc" className="btn btn-link btn-sm">
              View all
            </Link>
          </div>
          {upcoming.isLoading && <Loading />}
          {upcoming.error && <ErrorState error={upcoming.error} onRetry={() => upcoming.refetch()} />}
          {upcoming.data && upcoming.data.rows.length === 0 && <Empty title="No upcoming deadlines" />}
          {upcoming.data && upcoming.data.rows.length > 0 && (
            <ul className="list">
              {upcoming.data.rows.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className="list-item">
                    <div className="list-main">
                      <span className="ref">{t.reference_no}</span>
                      <strong className="truncate">{t.title}</strong>
                      <span className="muted small">
                        {t.primary_employee_name}
                        {!isStaff && profile?.employee && (
                          <>
                            {' · '}
                            <RoleTag role={t.primary_employee_id === profile.employee.id ? 'primary' : 'collaborator'} />
                          </>
                        )}
                      </span>
                    </div>
                    <div className="list-side">
                      <PriorityBadge priority={t.priority} />
                      <span className="small">{dueLabel(t.due_date, false)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="activity-h">
          <div className="card-header">
            <h2 id="activity-h">
              <Activity size={18} aria-hidden /> Recent activity
            </h2>
          </div>
          {activity.isLoading && <Loading />}
          {activity.error && <ErrorState error={activity.error} onRetry={() => activity.refetch()} />}
          {activity.data && activity.data.length === 0 && <Empty title="No activity yet" />}
          {activity.data && activity.data.length > 0 && (
            <ul className="timeline compact">
              {activity.data.map((a) => (
                <li key={a.id}>
                  <div className="timeline-dot" aria-hidden />
                  <div>
                    <div>
                      <strong>{a.actor_name}</strong> {describeActivity(a)}{' '}
                      <Link to={`/tasks/${a.task_id}`} className="ref">
                        {a.reference_no}
                      </Link>
                    </div>
                    <div className="muted small">
                      {a.task_title} · <time dateTime={a.created_at}>{relativeTime(a.created_at)}</time>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricGrid({
  s,
  range,
  period,
  setPeriod,
}: {
  s: DashboardSummary;
  range: { from: string; to: string };
  period: PresetKey;
  setPeriod: (p: PresetKey) => void;
}) {
  const weekQs = `status=open&df=due&from=${s.week_start}&to=${s.week_end}&view=week`;
  const cards = [
    { label: 'Active tasks', value: s.total_active, icon: ClipboardList, to: '/tasks?status=open', tone: 'slate', hint: `${s.not_started} not started · ${s.on_hold} on hold` },
    { label: 'In progress', value: s.in_progress, icon: Loader, to: '/tasks?view=in_progress&status=In+Progress', tone: 'blue' },
    { label: 'Due this week', value: s.due_this_week, icon: CalendarClock, to: `/tasks?${weekQs}`, tone: 'amber', hint: `${formatDate(s.week_start)} – ${formatDate(s.week_end)}` },
    { label: 'Overdue', value: s.overdue, icon: AlertTriangle, to: '/tasks?view=overdue&overdue=1', tone: 'red' },
  ];
  return (
    <section className="metrics" aria-label="Key metrics">
      {cards.map((c) => (
        <Link key={c.label} to={c.to} className={`metric metric-${c.tone}`}>
          <div className="metric-top">
            <span>{c.label}</span>
            <c.icon size={18} aria-hidden />
          </div>
          <strong className="metric-value">{c.value}</strong>
          {c.hint && <span className="metric-hint">{c.hint}</span>}
        </Link>
      ))}
      <div className="metric metric-green">
        <div className="metric-top">
          <label htmlFor="period">Completed</label>
          <CheckCircle2 size={18} aria-hidden />
        </div>
        <Link to={`/tasks?view=completed&status=Completed&df=completed&from=${range.from}&to=${range.to}`} className="metric-value-link">
          <strong className="metric-value">{s.completed_in_period}</strong>
        </Link>
        <select id="period" className="metric-select" value={period} onChange={(e) => setPeriod(e.target.value as PresetKey)}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function Distribution({ s }: { s: DashboardSummary }) {
  const depts = useDepartments();
  const deptId = useMemo(() => new Map((depts.data ?? []).map((d) => [d.name, d.id])), [depts.data]);
  const [showAll, setShowAll] = useState(false);
  const employees = showAll ? s.by_employee : s.by_employee.slice(0, 10);
  const maxEmp = Math.max(1, ...s.by_employee.map((e) => e.primary_count + e.collaborator_count));
  const maxDept = Math.max(1, ...s.by_department.map((d) => d.open_count));

  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="emp-dist-h">
        <div className="card-header">
          <h2 id="emp-dist-h">Open workload by employee</h2>
          <div className="legend" aria-hidden>
            <span>
              <i className="sw sw-primary" /> Primary
            </span>
            <span>
              <i className="sw sw-collab" /> Collaborator
            </span>
          </div>
        </div>
        {s.by_employee.length === 0 ? (
          <Empty title="No open work assigned" />
        ) : (
          <>
            <ul className="bars" aria-label="Open tasks per employee: primary and collaborator">
              {employees.map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/employees/${e.id}`}
                    className="bar-row"
                    title={`${e.name}: ${e.primary_count} primary, ${e.collaborator_count} collaborator, ${e.overdue_count} overdue`}
                  >
                    <span className="bar-label">
                      <span className="truncate">{e.name}</span>
                      <span className="muted small truncate">{e.department}</span>
                    </span>
                    <span className="bar-track">
                      {e.primary_count > 0 && <span className="bar bar-primary" style={{ width: `${(e.primary_count / maxEmp) * 100}%` }} />}
                      {e.collaborator_count > 0 && (
                        <span className="bar bar-collab" style={{ width: `${(e.collaborator_count / maxEmp) * 100}%` }} />
                      )}
                    </span>
                    <span className="bar-value">
                      {e.primary_count} / {e.collaborator_count}
                      {e.overdue_count > 0 && <span className="overdue-text"> · {e.overdue_count} overdue</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="muted small">Values shown as primary / collaborator. A task with collaborators appears under each person involved.</p>
            {s.by_employee.length > 10 && (
              <button className="btn btn-link btn-sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show top 10' : `Show all ${s.by_employee.length} employees`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="dept-dist-h">
        <div className="card-header">
          <h2 id="dept-dist-h">Open tasks by department</h2>
        </div>
        {s.by_department.length === 0 ? (
          <Empty title="No open tasks" />
        ) : (
          <>
            <ul className="bars" aria-label="Open tasks per department">
              {s.by_department.map((d) => (
                <li key={d.department}>
                  <Link
                    to={`/tasks?status=open${deptId.get(d.department) ? `&dept=${deptId.get(d.department)}` : ''}`}
                    className="bar-row"
                    title={`${d.department}: ${d.open_count} open, ${d.overdue_count} overdue`}
                  >
                    <span className="bar-label">
                      <span className="truncate">{d.department}</span>
                    </span>
                    <span className="bar-track">
                      <span className="bar bar-primary" style={{ width: `${(d.open_count / maxDept) * 100}%` }} />
                    </span>
                    <span className="bar-value">
                      {d.open_count}
                      {d.overdue_count > 0 && <span className="overdue-text"> · {d.overdue_count} overdue</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="muted small">Each task is counted once, under the primary employee's department.</p>
          </>
        )}
      </section>
    </div>
  );
}

