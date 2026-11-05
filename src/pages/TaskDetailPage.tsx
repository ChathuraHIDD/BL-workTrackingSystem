import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, ArchiveRestore, Crown, MessageSquare, History, Pencil, Users } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorState, InlineError, Loading } from '../components/States';
import { ArchivedBadge, OverdueBadge, PriorityBadge, StatusBadge } from '../components/Badges';
import { ConfirmDialog } from '../components/Modal';
import { addComment, archiveTask, getTask, listActivity, listComments, setTaskStatus } from '../lib/api';
import { dueLabel, formatDate, formatDateTime, relativeTime } from '../lib/dates';
import { describeActivityLong } from '../lib/activity';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { friendlyError } from '../lib/errors';
import { STATUSES, type Status, type TaskRow } from '../lib/types';

export default function TaskDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const task = useQuery({ queryKey: ['task', id], queryFn: () => getTask(id) });

  if (task.isLoading) return <Loading />;
  if (task.error) return <ErrorState error={task.error} onRetry={() => task.refetch()} />;
  if (!task.data)
    return (
      <div className="page">
        <Empty title="Task not found">It may not exist, or you may not have access to it.</Empty>
        <div className="center">
          <button className="btn btn-secondary" onClick={() => navigate('/tasks')}>
            Back to tasks
          </button>
        </div>
      </div>
    );
  return <TaskDetail t={task.data} />;
}

function TaskDetail({ t }: { t: TaskRow }) {
  const { isStaff, profile } = useAuth();
  const qc = useQueryClient();
  const notify = useToast();
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [confirmArchive, setConfirmArchive] = useState(false);

  const myId = profile?.employee?.id;
  const isPrimary = !!myId && t.primary_employee_id === myId;
  const canChangeStatus = !t.is_archived && (isStaff || (isPrimary && t.status !== 'Completed'));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task', t.id] });
    qc.invalidateQueries({ queryKey: ['activity', t.id] });
    qc.invalidateQueries({ queryKey: ['comments', t.id] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const archive = useMutation({
    mutationFn: () => archiveTask(t.id, !t.is_archived),
    onSuccess: () => {
      notify(t.is_archived ? 'Task restored.' : 'Task archived. It remains searchable and exportable.');
      setConfirmArchive(false);
      invalidate();
    },
    onError: (e) => notify(friendlyError(e), 'error'),
  });

  return (
    <div className="page">
      <Link to="/tasks" className="back-link">
        <ArrowLeft size={16} aria-hidden /> All tasks
      </Link>
      <PageHeader
        title={t.title}
        subtitle={
          <span className="row gap-sm wrap">
            <span className="ref">{t.reference_no}</span>
            <PriorityBadge priority={t.priority} />
            <StatusBadge status={t.status} />
            {t.is_overdue && <OverdueBadge />}
            {t.is_archived && <ArchivedBadge />}
          </span>
        }
        actions={
          isStaff && (
            <>
              {!t.is_archived && (
                <Link to={`/tasks/${t.id}/edit`} className="btn btn-secondary">
                  <Pencil size={16} aria-hidden /> Edit
                </Link>
              )}
              <button className="btn btn-secondary" onClick={() => setConfirmArchive(true)}>
                {t.is_archived ? <ArchiveRestore size={16} aria-hidden /> : <Archive size={16} aria-hidden />}
                {t.is_archived ? 'Restore' : 'Archive'}
              </button>
            </>
          )
        }
      />

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card" aria-labelledby="desc-h">
            <h2 id="desc-h" className="card-title">
              Description
            </h2>
            {t.description ? <p className="prewrap">{t.description}</p> : <p className="muted">No description provided.</p>}
          </section>

          {canChangeStatus ? (
            <StatusPanel t={t} onDone={invalidate} />
          ) : (
            !t.is_archived &&
            !isStaff && (
              <div className="alert alert-info">
                {t.status === 'Completed'
                  ? 'This task is completed. Ask a manager if it needs to be reopened.'
                  : 'As a collaborator you can post progress updates below. The primary employee or a manager updates the status.'}
              </div>
            )
          )}

          <section className="card">
            <div className="tabs" role="tablist" aria-label="Task timeline">
              <button role="tab" aria-selected={tab === 'comments'} className={`tab ${tab === 'comments' ? 'tab-active' : ''}`} onClick={() => setTab('comments')}>
                <MessageSquare size={15} aria-hidden /> Comments &amp; updates
              </button>
              <button role="tab" aria-selected={tab === 'history'} className={`tab ${tab === 'history' ? 'tab-active' : ''}`} onClick={() => setTab('history')}>
                <History size={15} aria-hidden /> Activity history
              </button>
            </div>
            {tab === 'comments' ? <Comments taskId={t.id} archived={t.is_archived} /> : <HistoryList taskId={t.id} />}
          </section>
        </div>

        <aside className="detail-side">
          <section className="card" aria-labelledby="people-h">
            <h2 id="people-h" className="card-title">
              People
            </h2>
            <div className="person primary-person">
              <div className="person-role">
                <Crown size={14} aria-hidden /> Primary responsible
              </div>
              <Link to={`/employees/${t.primary_employee_id}`} className="person-name">
                {t.primary_employee_name}
              </Link>
              <div className="muted small">
                {t.department_name}
                {!t.primary_employee_active && ' · inactive'}
              </div>
            </div>
            <div className="person">
              <div className="person-role">
                <Users size={14} aria-hidden /> Collaborators ({t.collaborators.length})
              </div>
              {t.collaborators.length === 0 ? (
                <div className="muted small">None</div>
              ) : (
                <ul className="plain-list">
                  {t.collaborators.map((c) => (
                    <li key={c.id}>
                      <Link to={`/employees/${c.id}`}>{c.name}</Link>
                      <span className="muted small">
                        {' '}
                        · {c.department}
                        {!c.is_active && ' · inactive'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="facts-h">
            <h2 id="facts-h" className="card-title">
              Details
            </h2>
            <dl className="facts">
              <dt>Due date</dt>
              <dd>
                {formatDate(t.due_date)}
                {t.status !== 'Completed' && <div className={`small ${t.is_overdue ? 'overdue-text' : 'muted'}`}>{dueLabel(t.due_date, false)}</div>}
              </dd>
              <dt>Department</dt>
              <dd>{t.department_name}</dd>
              <dt>Completed</dt>
              <dd>{t.completed_at ? formatDateTime(t.completed_at) : '—'}</dd>
              <dt>Created</dt>
              <dd>
                {formatDateTime(t.created_at)}
                <div className="muted small">by {t.created_by_name}</div>
              </dd>
              <dt>Last updated</dt>
              <dd>{formatDateTime(t.updated_at)}</dd>
              {t.is_archived && (
                <>
                  <dt>Archived</dt>
                  <dd>{formatDateTime(t.archived_at)}</dd>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>

      {confirmArchive && (
        <ConfirmDialog
          title={t.is_archived ? 'Restore this task?' : 'Archive this task?'}
          message={
            t.is_archived ? (
              <>
                <strong>{t.reference_no}</strong> will return to active lists and reminders will resume if it is not completed.
              </>
            ) : (
              <>
                <strong>{t.reference_no}</strong> will be hidden from active lists and no further reminders will be sent. The record and its
                history are kept and remain searchable and exportable. You can restore it at any time.
              </>
            )
          }
          confirmLabel={t.is_archived ? 'Restore task' : 'Archive task'}
          tone={t.is_archived ? 'primary' : 'danger'}
          busy={archive.isPending}
          onConfirm={() => archive.mutate()}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </div>
  );
}

function StatusPanel({ t, onDone }: { t: TaskRow; onDone: () => void }) {
  const notify = useToast();
  const [status, setStatus] = useState<Status>(t.status);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const m = useMutation({
    mutationFn: () => setTaskStatus(t.id, status, note),
    onSuccess: () => {
      notify(status === t.status ? 'Progress update posted.' : `Status changed to ${status}.`);
      setNote('');
      setConfirm(false);
      onDone();
    },
    onError: (e) => {
      setConfirm(false);
      notify(friendlyError(e), 'error');
    },
  });
  const changed = status !== t.status;
  const needsConfirm = changed && (status === 'Completed' || t.status === 'Completed');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed && !note.trim()) return;
    if (needsConfirm) setConfirm(true);
    else m.mutate();
  }

  return (
    <section className="card" aria-labelledby="status-h">
      <h2 id="status-h" className="card-title">
        Update status
      </h2>
      <form onSubmit={submit} className="status-form">
        <div className="field">
          <label htmlFor="st">Status</label>
          <select id="st" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="st-note">Progress note (optional)</label>
          <input id="st-note" value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" />
        </div>
        <button className="btn btn-primary" disabled={m.isPending || (!changed && !note.trim())}>
          {m.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
      {confirm && (
        <ConfirmDialog
          title={status === 'Completed' ? 'Mark as completed?' : 'Reopen this task?'}
          message={
            status === 'Completed'
              ? 'The completion date and time will be recorded now and reminders will stop.'
              : `The task will be reopened as "${status}" and its completion time cleared. This is recorded in the history.`
          }
          confirmLabel={status === 'Completed' ? 'Mark completed' : 'Reopen task'}
          busy={m.isPending}
          onConfirm={() => m.mutate()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </section>
  );
}

function Comments({ taskId, archived }: { taskId: string; archived: boolean }) {
  const qc = useQueryClient();
  const notify = useToast();
  const comments = useQuery({ queryKey: ['comments', taskId], queryFn: () => listComments(taskId) });
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'comment' | 'progress'>('progress');
  const m = useMutation({
    mutationFn: () => addComment(taskId, body, kind),
    onSuccess: () => {
      setBody('');
      notify(kind === 'progress' ? 'Progress update posted.' : 'Comment posted.');
      qc.invalidateQueries({ queryKey: ['comments', taskId] });
    },
  });

  return (
    <div className="tab-panel">
      {!archived && (
        <form
          className="comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) m.mutate();
          }}
        >
          <label htmlFor="cbody" className="sr-only">
            Add a comment or progress update
          </label>
          <textarea
            id="cbody"
            rows={3}
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share progress, blockers or a note for the team…"
          />
          <InlineError error={m.error} />
          <div className="row between wrap gap-sm">
            <fieldset className="segmented">
              <legend className="sr-only">Entry type</legend>
              <label className={kind === 'progress' ? 'on' : ''}>
                <input type="radio" name="kind" checked={kind === 'progress'} onChange={() => setKind('progress')} /> Progress update
              </label>
              <label className={kind === 'comment' ? 'on' : ''}>
                <input type="radio" name="kind" checked={kind === 'comment'} onChange={() => setKind('comment')} /> Comment
              </label>
            </fieldset>
            <button className="btn btn-primary" disabled={!body.trim() || m.isPending}>
              {m.isPending ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      )}
      {comments.isLoading && <Loading />}
      {comments.error && <ErrorState error={comments.error} onRetry={() => comments.refetch()} />}
      {comments.data && comments.data.length === 0 && <Empty title="No comments yet" />}
      {comments.data && comments.data.length > 0 && (
        <ul className="comments">
          {comments.data.map((c) => (
            <li key={c.id} className={`comment ${c.kind === 'progress' ? 'comment-progress' : ''}`}>
              <div className="comment-head">
                <strong>{c.author_name}</strong>
                <span className={`mini-tag ${c.kind === 'progress' ? 'mini-progress' : ''}`}>{c.kind === 'progress' ? 'Progress update' : 'Comment'}</span>
                <time className="muted small" dateTime={c.created_at} title={formatDateTime(c.created_at)}>
                  {relativeTime(c.created_at)}
                </time>
              </div>
              <p className="prewrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryList({ taskId }: { taskId: string }) {
  const q = useQuery({ queryKey: ['activity', taskId], queryFn: () => listActivity(taskId) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <Empty title="No history recorded" />;
  return (
    <ul className="timeline tab-panel">
      {q.data.map((a) => (
        <li key={a.id}>
          <div className={`timeline-dot dot-${a.action}`} aria-hidden />
          <div>
            <div>{describeActivityLong(a)}</div>
            <div className="muted small">
              {a.actor_name} · <time dateTime={a.created_at}>{formatDateTime(a.created_at)}</time>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
