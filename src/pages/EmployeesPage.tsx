import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, UserCheck, UserX } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorState, InlineError, Loading } from '../components/States';
import { ActiveBadge } from '../components/Badges';
import { ConfirmDialog, Modal } from '../components/Modal';
import { countOpenTasksFor, saveEmployee, setEmployeeActive, type EmployeeInput } from '../lib/api';
import { useDepartments, useEmployees } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { friendlyError } from '../lib/errors';
import type { Employee } from '../lib/types';

export default function EmployeesPage() {
  const { isAdmin } = useAuth();
  const employees = useEmployees();
  const departments = useDepartments();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [toggling, setToggling] = useState<Employee | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (employees.data ?? []).filter(
      (e) =>
        (status === 'all' || (status === 'active' ? e.is_active : !e.is_active)) &&
        (!dept || String(e.department_id) === dept) &&
        (!term || `${e.full_name} ${e.email} ${e.job_title ?? ''} ${e.department_name}`.toLowerCase().includes(term)),
    );
  }, [employees.data, q, dept, status]);

  return (
    <div className="page">
      <PageHeader
        title="Employees"
        subtitle="Employee records are kept permanently. Deactivate people who leave — their history is preserved."
        actions={
          isAdmin && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={18} aria-hidden /> Add employee
            </button>
          )
        }
      />

      <div className="toolbar">
        <div className="search-input grow">
          <Search size={16} aria-hidden />
          <input type="search" placeholder="Search name, email, job title…" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="inline-field">
          <span className="sr-only">Department</span>
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span className="sr-only">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      <section className="card table-card">
        {employees.isLoading && <Loading />}
        {employees.error && <ErrorState error={employees.error} onRetry={() => employees.refetch()} />}
        {employees.data && rows.length === 0 && (
          <Empty title="No employees found">{employees.data.length === 0 && isAdmin ? 'Add your first employee to start assigning work.' : 'Try a different search or filter.'}</Empty>
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Department</th>
                  <th scope="col">Job title</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  {isAdmin && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Name">
                      <Link to={`/employees/${e.id}`} className="strong-link">
                        {e.full_name}
                      </Link>
                    </td>
                    <td data-label="Department">{e.department_name}</td>
                    <td data-label="Job title">{e.job_title ?? <span className="muted">—</span>}</td>
                    <td data-label="Email" className="break">
                      {e.email}
                    </td>
                    <td data-label="Status">
                      <ActiveBadge active={e.is_active} />
                    </td>
                    {isAdmin && (
                      <td data-label="Actions" className="actions-cell">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)} aria-label={`Edit ${e.full_name}`}>
                          <Pencil size={15} aria-hidden /> Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setToggling(e)} aria-label={`${e.is_active ? 'Deactivate' : 'Reactivate'} ${e.full_name}`}>
                          {e.is_active ? <UserX size={15} aria-hidden /> : <UserCheck size={15} aria-hidden />}
                          {e.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && <EmployeeFormModal employee={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {toggling && <ToggleActiveDialog employee={toggling} onClose={() => setToggling(null)} />}
    </div>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function EmployeeFormModal({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const departments = useDepartments();
  const qc = useQueryClient();
  const notify = useToast();
  const [v, setV] = useState<EmployeeInput>({
    full_name: employee?.full_name ?? '',
    department_id: employee?.department_id ?? 0,
    job_title: employee?.job_title ?? '',
    email: employee?.email ?? '',
    is_active: employee?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: () => saveEmployee(employee?.id ?? null, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee'] });
      notify(employee ? 'Employee updated.' : 'Employee added.');
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.full_name.trim().length < 2) errs.full_name = 'Enter the full name.';
    if (!v.department_id) errs.department_id = 'Select a department.';
    if (!EMAIL_RE.test(v.email.trim())) errs.email = 'Enter a valid email address.';
    if (v.job_title.length > 120) errs.job_title = 'Job title is too long.';
    setErrors(errs);
    if (Object.keys(errs).length === 0) m.mutate();
  }

  const activeDepts = (departments.data ?? []).filter((d) => d.is_active || d.id === v.department_id);

  return (
    <Modal
      title={employee ? `Edit ${employee.full_name}` : 'Add employee'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={m.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="emp-form" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
          </button>
        </>
      }
    >
      <form id="emp-form" className="form" onSubmit={submit} noValidate>
        <InlineError error={m.error} />
        <div className="field">
          <label htmlFor="ef-name">
            Full name <span className="req">*</span>
          </label>
          <input id="ef-name" value={v.full_name} maxLength={120} onChange={(e) => setV({ ...v, full_name: e.target.value })} aria-invalid={!!errors.full_name || undefined} />
          {errors.full_name && <p className="field-error">{errors.full_name}</p>}
        </div>
        <div className="field">
          <label htmlFor="ef-dept">
            Department <span className="req">*</span>
          </label>
          <select id="ef-dept" value={v.department_id || ''} onChange={(e) => setV({ ...v, department_id: Number(e.target.value) })} aria-invalid={!!errors.department_id || undefined}>
            <option value="">Select department</option>
            {activeDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {errors.department_id && <p className="field-error">{errors.department_id}</p>}
          {employee && v.department_id !== employee.department_id && (
            <p className="hint">Existing tasks keep the department recorded when they were assigned.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="ef-title">Job title</label>
          <input id="ef-title" value={v.job_title} maxLength={120} onChange={(e) => setV({ ...v, job_title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ef-email">
            Email address <span className="req">*</span>
          </label>
          <input id="ef-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} aria-invalid={!!errors.email || undefined} aria-describedby="ef-email-hint" />
          <p id="ef-email-hint" className="hint">
            Used for reminders and for the login invitation.
          </p>
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>
      </form>
    </Modal>
  );
}

export function ToggleActiveDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useToast();
  const open = useQuery({
    queryKey: ['open-count', employee.id],
    queryFn: () => countOpenTasksFor(employee.id),
    enabled: employee.is_active,
  });
  const openCount = open.data ?? null;
  const m = useMutation({
    mutationFn: () => setEmployeeActive(employee.id, !employee.is_active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee', employee.id] });
      notify(employee.is_active ? `${employee.full_name} deactivated. Their history is preserved.` : `${employee.full_name} reactivated.`);
      onClose();
    },
    onError: (e) => notify(friendlyError(e), 'error'),
  });
  return (
    <ConfirmDialog
      title={employee.is_active ? `Deactivate ${employee.full_name}?` : `Reactivate ${employee.full_name}?`}
      message={
        employee.is_active ? (
          <>
            <p>
              They will no longer be selectable for new assignments or receive reminders. All of their past work, comments and history are
              kept and stay searchable and exportable.
            </p>
            {openCount !== null && openCount > 0 && (
              <p className="alert alert-warn">
                {openCount} open task{openCount === 1 ? '' : 's'} still involve this employee. Consider reassigning them first.
              </p>
            )}
            <p className="muted small">Their login account (if any) is managed separately under Administration → User accounts.</p>
          </>
        ) : (
          'They will be available for assignments and reminders again.'
        )
      }
      confirmLabel={employee.is_active ? 'Deactivate' : 'Reactivate'}
      tone={employee.is_active ? 'danger' : 'primary'}
      busy={m.isPending}
      onConfirm={() => m.mutate()}
      onCancel={onClose}
    />
  );
}
