import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, Mail, Pencil, Plus, Send, Timer } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorState, InlineError, Loading } from '../components/States';
import { ActiveBadge } from '../components/Badges';
import { ConfirmDialog, Modal } from '../components/Modal';
import {
  accountAction,
  getSettings,
  listAccounts,
  listDeliveries,
  saveDepartment,
  updateSettings,
  type AccountRow,
} from '../lib/api';
import { formatDateTime } from '../lib/dates';
import { useDepartments, useEmployees } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { friendlyError } from '../lib/errors';
import { ROLE_LABELS, type Department, type Role } from '../lib/types';

type Section = 'accounts' | 'reminders' | 'departments' | 'delivery';

export default function SettingsPage() {
  const [section, setSection] = useState<Section>('accounts');
  const items: [Section, string, typeof KeyRound][] = [
    ['accounts', 'User accounts', KeyRound],
    ['reminders', 'Reminders', Timer],
    ['departments', 'Departments', Building2],
    ['delivery', 'Email delivery log', Mail],
  ];
  return (
    <div className="page">
      <PageHeader title="Administration" subtitle="Accounts, roles, reminder schedule, departments and delivery monitoring." />
      <div className="tabs" role="tablist" aria-label="Administration sections">
        {items.map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={section === k} className={`tab ${section === k ? 'tab-active' : ''}`} onClick={() => setSection(k)}>
            <Icon size={15} aria-hidden /> {label}
          </button>
        ))}
      </div>
      {section === 'accounts' && <Accounts />}
      {section === 'reminders' && <Reminders />}
      {section === 'departments' && <Departments />}
      {section === 'delivery' && <DeliveryLog />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Accounts() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const notify = useToast();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts });
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<{ a: AccountRow; active: boolean } | null>(null);

  const act = useMutation({
    mutationFn: accountAction,
    onSuccess: (r) => {
      notify(r.message ?? 'Saved.');
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => {
      setConfirm(null);
      notify(friendlyError(e), 'error');
    },
  });

  return (
    <section className="card table-card">
      <div className="card-header pad">
        <div>
          <h2 className="card-title">Login accounts</h2>
          <p className="muted small">Accounts are linked to employee records but managed separately. Public sign-up is disabled — people join by invitation only.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setInviting(true)}>
          <Plus size={16} aria-hidden /> Invite user
        </button>
      </div>
      {accounts.isLoading && <Loading />}
      {accounts.error && <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />}
      {accounts.data && accounts.data.accounts.length === 0 && <Empty title="No accounts yet" />}
      {accounts.data && accounts.data.accounts.length > 0 && (
        <div className="table-wrap">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Employee</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.data.accounts.map((a) => {
                const self = a.user_id === profile?.userId;
                return (
                  <tr key={a.user_id}>
                    <td data-label="Email" className="break">
                      {a.email}
                      {!a.confirmed && <div className="muted small">Invitation pending</div>}
                    </td>
                    <td data-label="Employee">{a.employee_name ?? <span className="muted">Not linked</span>}</td>
                    <td data-label="Role">
                      <label className="sr-only" htmlFor={`role-${a.user_id}`}>
                        Role for {a.email}
                      </label>
                      <select
                        id={`role-${a.user_id}`}
                        value={a.role}
                        disabled={act.isPending || self}
                        title={self ? 'You cannot change your own role' : undefined}
                        onChange={(e) => act.mutate({ action: 'update', user_id: a.user_id, role: e.target.value as Role })}
                      >
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Status">
                      <ActiveBadge active={a.is_active} />
                    </td>
                    <td data-label="Last sign-in">{a.last_sign_in_at ? formatDateTime(a.last_sign_in_at) : <span className="muted">Never</span>}</td>
                    <td data-label="Actions" className="actions-cell">
                      {!a.confirmed && a.is_active && (
                        <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ action: 'resend', user_id: a.user_id })}>
                          <Send size={14} aria-hidden /> Resend invite
                        </button>
                      )}
                      {a.confirmed && a.is_active && (
                        <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ action: 'resend', user_id: a.user_id })}>
                          <Send size={14} aria-hidden /> Send password reset
                        </button>
                      )}
                      {!self && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ a, active: !a.is_active })}>
                          {a.is_active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {inviting && <InviteModal existing={accounts.data?.accounts ?? []} onClose={() => setInviting(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.active ? 'Enable this account?' : 'Disable this account?'}
          message={
            confirm.active
              ? `${confirm.a.email} will be able to sign in again.`
              : `${confirm.a.email} will be signed out and unable to sign in. Their employee record and all work history are unaffected.`
          }
          confirmLabel={confirm.active ? 'Enable account' : 'Disable account'}
          tone={confirm.active ? 'primary' : 'danger'}
          busy={act.isPending}
          onConfirm={() => act.mutate({ action: 'update', user_id: confirm.a.user_id, is_active: confirm.active })}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}

function InviteModal({ existing, onClose }: { existing: AccountRow[]; onClose: () => void }) {
  const employees = useEmployees();
  const qc = useQueryClient();
  const notify = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [error, setError] = useState('');
  const linked = new Set(existing.map((a) => a.employee_id));
  const options = (employees.data ?? []).filter((e) => e.is_active && !linked.has(e.id));
  const m = useMutation({
    mutationFn: () => accountAction({ action: 'invite', employee_id: employeeId, role }),
    onSuccess: (r) => {
      notify(r.message ?? 'Invitation sent.');
      qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!employeeId) return setError('Select an employee.');
    setError('');
    m.mutate();
  }
  const selected = options.find((o) => o.id === employeeId);
  return (
    <Modal
      title="Invite user"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={m.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" form="invite-form" disabled={m.isPending}>
            {m.isPending ? 'Sending…' : 'Send invitation'}
          </button>
        </>
      }
    >
      <form id="invite-form" className="form" onSubmit={submit} noValidate>
        <InlineError error={m.error} />
        <div className="field">
          <label htmlFor="inv-emp">
            Employee <span className="req">*</span>
          </label>
          <select id="inv-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-invalid={!!error || undefined}>
            <option value="">Select an employee without an account</option>
            {options.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} — {e.department_name}
              </option>
            ))}
          </select>
          {error && <p className="field-error">{error}</p>}
          {selected && <p className="hint">The invitation will be emailed to {selected.email}.</p>}
          {options.length === 0 && <p className="hint">Every active employee already has an account. Add the employee first under Employees.</p>}
        </div>
        <div className="field">
          <label htmlFor="inv-role">Role</label>
          <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="employee">Employee — own assignments, progress updates, own summaries</option>
            <option value="manager">Manager — create/assign tasks, company-wide reports</option>
            <option value="admin">Administrator — full access including settings</option>
          </select>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function Reminders() {
  const qc = useQueryClient();
  const notify = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const [time, setTime] = useState('09:00');
  const [days, setDays] = useState<number[]>([2, 1]);
  const [email, setEmail] = useState(true);

  useEffect(() => {
    if (s.data) {
      setTime(s.data.reminder_time.slice(0, 5));
      setDays(s.data.reminder_days_before);
      setEmail(s.data.email_notifications_enabled);
    }
  }, [s.data]);

  const m = useMutation({
    mutationFn: () => updateSettings({ reminder_time: time, reminder_days_before: [...days].sort((a, b) => b - a), email_notifications_enabled: email }),
    onSuccess: () => {
      notify('Reminder settings saved.');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorState error={s.error} onRetry={() => s.refetch()} />;

  return (
    <section className="card narrow-card">
      <h2 className="card-title">Due-date reminders</h2>
      <p className="muted small">
        A scheduled database job checks every 15 minutes. Once the reminder time has passed (Asia/Colombo), it notifies the primary employee and
        collaborators of incomplete, non-archived tasks. Each reminder is sent only once per person, per task, per due date.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!days.length) return notify('Select at least one reminder day.', 'error');
          m.mutate();
        }}
      >
        <InlineError error={m.error} />
        <div className="field">
          <label htmlFor="rem-time">Reminder time (Asia/Colombo)</label>
          <input id="rem-time" type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} required />
        </div>
        <fieldset className="field">
          <legend className="label">Send reminders</legend>
          <div className="row gap wrap">
            {[3, 2, 1].map((d) => (
              <label key={d} className="checkbox">
                <input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))} />
                {d} day{d > 1 ? 's' : ''} before
              </label>
            ))}
          </div>
        </fieldset>
        <label className="checkbox">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also send notifications by email
        </label>
        <p className="muted small">Last reminder run: {s.data?.last_reminder_run_at ? formatDateTime(s.data.last_reminder_run_at) : 'not yet'}</p>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
function Departments() {
  const depts = useDepartments();
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  return (
    <section className="card table-card narrow-card">
      <div className="card-header pad">
        <h2 className="card-title">Departments</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Plus size={15} aria-hidden /> Add department
        </button>
      </div>
      {depts.isLoading && <Loading />}
      {depts.error && <ErrorState error={depts.error} onRetry={() => depts.refetch()} />}
      {depts.data && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {depts.data.map((d) => (
              <tr key={d.id}>
                <td>{d.sort_order}</td>
                <td>{d.name}</td>
                <td>
                  <ActiveBadge active={d.is_active} />
                </td>
                <td className="actions-cell">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
                    <Pencil size={14} aria-hidden /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <DepartmentModal dept={editing === 'new' ? null : editing} nextOrder={(depts.data?.length ?? 0) + 1} onClose={() => setEditing(null)} />}
    </section>
  );
}

function DepartmentModal({ dept, nextOrder, onClose }: { dept: Department | null; nextOrder: number; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useToast();
  const [name, setName] = useState(dept?.name ?? '');
  const [order, setOrder] = useState(dept?.sort_order ?? nextOrder);
  const [active, setActive] = useState(dept?.is_active ?? true);
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: () => saveDepartment({ id: dept?.id, name, sort_order: order, is_active: active }),
    onSuccess: () => {
      notify('Department saved.');
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
  });
  return (
    <Modal
      title={dept ? 'Edit department' : 'Add department'}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="dept-form" disabled={m.isPending}>
            Save
          </button>
        </>
      }
    >
      <form
        id="dept-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) return setError('Enter a department name.');
          setError('');
          m.mutate();
        }}
        noValidate
      >
        <InlineError error={m.error} />
        <div className="field">
          <label htmlFor="d-name">Name</label>
          <input id="d-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={!!error || undefined} />
          {error && <p className="field-error">{error}</p>}
          {dept && <p className="hint">Renaming updates every task and report that references this department.</p>}
        </div>
        <div className="field">
          <label htmlFor="d-order">Display order</label>
          <input id="d-order" type="number" min={0} value={order} onChange={(e) => setOrder(Number(e.target.value))} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (available for new employees)
        </label>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function DeliveryLog() {
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['deliveries', status], queryFn: () => listDeliveries(status), refetchInterval: 60_000 });
  return (
    <section className="card table-card">
      <div className="card-header pad">
        <div>
          <h2 className="card-title">Email delivery log</h2>
          <p className="muted small">Every email attempt is recorded. Failed sends are retried up to 5 times with increasing delays.</p>
        </div>
        <label className="inline-field">
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <Empty title="No email deliveries recorded" />}
      {q.data && q.data.length > 0 && (
        <div className="table-wrap">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th scope="col">Created</th>
                <th scope="col">Recipient</th>
                <th scope="col">Notification</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => (
                <tr key={d.id}>
                  <td data-label="Created" className="nowrap">
                    {formatDateTime(d.created_at)}
                  </td>
                  <td data-label="Recipient" className="break">
                    {d.recipient_email}
                  </td>
                  <td data-label="Notification">{d.notifications?.title}</td>
                  <td data-label="Status">
                    <span className={`badge delivery-${d.status}`}>{d.status}</span>
                  </td>
                  <td data-label="Attempts">{d.attempts}</td>
                  <td data-label="Detail" className="muted small">
                    {d.status === 'sent' ? `Sent ${formatDateTime(d.sent_at)}` : (d.last_error ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
