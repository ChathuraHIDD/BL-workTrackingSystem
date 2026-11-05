import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { ErrorState, InlineError, Loading } from '../components/States';
import { EmployeeMultiSelect, EmployeeSelect } from '../components/EmployeePicker';
import { getTask, saveTask, type TaskInput } from '../lib/api';
import { addDays, formatDate, isValidISODate, todayISO } from '../lib/dates';
import { useEmployees } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { PRIORITIES, STATUSES, type Priority, type Status, type TaskRow } from '../lib/types';

type Errors = Partial<Record<keyof TaskInput, string>>;

function validate(v: TaskInput): Errors {
  const e: Errors = {};
  if (v.title.trim().length < 3) e.title = 'Enter a title of at least 3 characters.';
  else if (v.title.trim().length > 200) e.title = 'Keep the title under 200 characters.';
  if (v.description.length > 10000) e.description = 'Description is too long (max 10,000 characters).';
  if (!v.primary_employee_id) e.primary_employee_id = 'Select the primary responsible employee.';
  if (!v.due_date || !isValidISODate(v.due_date)) e.due_date = 'Select a valid due date.';
  if (!PRIORITIES.includes(v.priority)) e.priority = 'Select a priority.';
  return e;
}

export default function TaskFormPage() {
  const { id } = useParams();
  const existing = useQuery({ queryKey: ['task', id], queryFn: () => getTask(id!), enabled: !!id });
  if (id && existing.isLoading) return <Loading />;
  if (id && existing.error) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (id && !existing.data) return <ErrorState error={new Error('Task not found.')} />;
  return <TaskForm task={existing.data ?? null} />;
}

function TaskForm({ task }: { task: TaskRow | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useToast();
  const employees = useEmployees();
  const [values, setValues] = useState<TaskInput>(() => ({
    title: task?.title ?? '',
    description: task?.description ?? '',
    primary_employee_id: task?.primary_employee_id ?? '',
    collaborator_ids: task?.collaborator_ids ?? [],
    due_date: task?.due_date ?? addDays(todayISO(), 7),
    priority: (task?.priority ?? 'Medium') as Priority,
    status: (task?.status ?? 'Not Started') as Status,
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (submitted) setErrors(validate(values));
  }, [values, submitted]);

  const set = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => setValues((s) => ({ ...s, [k]: v }));

  const m = useMutation({
    mutationFn: () => saveTask(task?.id ?? null, values),
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', newId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      notify(task ? 'Task updated.' : 'Task created and assignees notified.');
      navigate(`/tasks/${newId}`);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById(`tf-${first}`)?.focus();
      return;
    }
    m.mutate();
  }

  const pastDue = values.due_date && values.due_date < todayISO() && values.status !== 'Completed';
  const err = (k: keyof TaskInput) =>
    errors[k] ? (
      <p id={`tf-${k}-err`} className="field-error">
        {errors[k]}
      </p>
    ) : null;

  return (
    <div className="page narrow">
      <Link to={task ? `/tasks/${task.id}` : '/tasks'} className="back-link">
        <ArrowLeft size={16} aria-hidden /> {task ? 'Back to task' : 'All tasks'}
      </Link>
      <PageHeader title={task ? `Edit ${task.reference_no}` : 'New work record'} subtitle={task ? task.title : 'A reference number is generated automatically.'} />

      <form className="card form" onSubmit={submit} noValidate>
        <InlineError error={m.error} />

        <div className="field">
          <label htmlFor="tf-title">
            Work title <span className="req">*</span>
          </label>
          <input
            id="tf-title"
            value={values.title}
            maxLength={200}
            onChange={(e) => set('title', e.target.value)}
            aria-invalid={!!errors.title || undefined}
            aria-describedby={errors.title ? 'tf-title-err' : undefined}
          />
          {err('title')}
        </div>

        <div className="field">
          <label htmlFor="tf-description">Detailed description</label>
          <textarea
            id="tf-description"
            rows={6}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            aria-invalid={!!errors.description || undefined}
          />
          {err('description')}
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="tf-primary_employee_id">
              Primary responsible employee <span className="req">*</span>
            </label>
            {employees.isLoading ? (
              <Loading label="Loading employees…" />
            ) : (
              <EmployeeSelect
                id="tf-primary_employee_id"
                employees={employees.data ?? []}
                value={values.primary_employee_id}
                onChange={(v) =>
                  setValues((s) => ({ ...s, primary_employee_id: v, collaborator_ids: s.collaborator_ids.filter((c) => c !== v) }))
                }
                invalid={!!errors.primary_employee_id}
                describedBy={errors.primary_employee_id ? 'tf-primary_employee_id-err' : 'tf-primary-hint'}
              />
            )}
            <p id="tf-primary-hint" className="hint">
              Owns the outcome and receives reminders. Only one person.
            </p>
            {err('primary_employee_id')}
          </div>

          <div className="field">
            <label htmlFor="tf-due_date">
              Due date <span className="req">*</span>
            </label>
            <input
              id="tf-due_date"
              type="date"
              value={values.due_date}
              onChange={(e) => set('due_date', e.target.value)}
              aria-invalid={!!errors.due_date || undefined}
            />
            {pastDue && !errors.due_date && <p className="hint warn">This date is in the past — the task will show as overdue.</p>}
            {values.due_date && isValidISODate(values.due_date) && <p className="hint">{formatDate(values.due_date)}</p>}
            {err('due_date')}
          </div>

          <div className="field">
            <label htmlFor="tf-priority">
              Priority <span className="req">*</span>
            </label>
            <select id="tf-priority" value={values.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="tf-status">Status</label>
            <select id="tf-status" value={values.status} onChange={(e) => set('status', e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <p className="hint">Completion time is recorded automatically.</p>
          </div>
        </div>

        <div className="field">
          <span id="tf-collab-label" className="label">
            Collaborators <span className="muted">(optional)</span>
          </span>
          <p className="hint">Support the primary employee, receive reminders and can post progress updates.</p>
          <EmployeeMultiSelect
            employees={employees.data ?? []}
            value={values.collaborator_ids}
            onChange={(v) => set('collaborator_ids', v)}
            excludeId={values.primary_employee_id}
            labelledBy="tf-collab-label"
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)} disabled={m.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : task ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </form>
    </div>
  );
}
