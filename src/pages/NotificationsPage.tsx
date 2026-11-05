import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarClock, CheckCheck, UserPlus, Users } from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorState, Loading } from '../components/States';
import { listNotifications, markNotificationsRead } from '../lib/api';
import { formatDateTime, relativeTime } from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { friendlyError } from '../lib/errors';
import type { NotificationRow } from '../lib/types';

const ICONS: Record<NotificationRow['kind'], typeof BellRing> = {
  assigned: UserPlus,
  collaborator_added: Users,
  due_date_changed: CalendarClock,
  due_reminder: BellRing,
};

export default function NotificationsPage() {
  const { profile } = useAuth();
  const employeeId = profile?.employee?.id;
  const [unreadOnly, setUnreadOnly] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const notify = useToast();

  const q = useQuery({
    queryKey: ['notifications', employeeId, unreadOnly],
    queryFn: () => listNotifications(employeeId!, unreadOnly),
    enabled: !!employeeId,
    refetchInterval: 60_000,
  });

  const mark = useMutation({
    mutationFn: (ids: string[] | null) => markNotificationsRead(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    },
    onError: (e) => notify(friendlyError(e), 'error'),
  });

  if (!employeeId) {
    return (
      <div className="page">
        <PageHeader title="Notifications" />
        <Empty title="No employee record linked">Notifications are delivered to employee records. Ask an administrator to link your account.</Empty>
      </div>
    );
  }

  const unread = (q.data ?? []).filter((n) => !n.is_read).length;

  function open(n: NotificationRow) {
    if (!n.is_read) mark.mutate([n.id]);
    if (n.task_id) navigate(`/tasks/${n.task_id}`);
  }

  return (
    <div className="page narrow">
      <PageHeader
        title="Notifications"
        subtitle="Assignments, due-date changes and reminders sent 2 days and 1 day before a deadline."
        actions={
          <button className="btn btn-secondary" onClick={() => mark.mutate(null)} disabled={mark.isPending || unread === 0}>
            <CheckCheck size={16} aria-hidden /> Mark all as read
          </button>
        }
      />
      <div className="tabs" role="tablist" aria-label="Filter notifications">
        <button role="tab" aria-selected={!unreadOnly} className={`tab ${!unreadOnly ? 'tab-active' : ''}`} onClick={() => setUnreadOnly(false)}>
          All
        </button>
        <button role="tab" aria-selected={unreadOnly} className={`tab ${unreadOnly ? 'tab-active' : ''}`} onClick={() => setUnreadOnly(true)}>
          Unread
        </button>
      </div>
      <section className="card">
        {q.isLoading && <Loading />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && q.data.length === 0 && <Empty title={unreadOnly ? 'You are all caught up' : 'No notifications yet'} />}
        {q.data && q.data.length > 0 && (
          <ul className="notif-list">
            {q.data.map((n) => {
              const Icon = ICONS[n.kind] ?? BellRing;
              return (
                <li key={n.id} className={n.is_read ? 'read' : 'unread'}>
                  <button className="notif" onClick={() => open(n)}>
                    <span className={`notif-ico kind-${n.kind}`} aria-hidden>
                      <Icon size={18} />
                    </span>
                    <span className="notif-body">
                      <span className="notif-title">
                        {!n.is_read && <span className="sr-only">Unread: </span>}
                        {n.title}
                      </span>
                      <span className="muted small">{n.body}</span>
                      <time className="muted small" dateTime={n.created_at} title={formatDateTime(n.created_at)}>
                        {relativeTime(n.created_at)}
                      </time>
                    </span>
                    {!n.is_read && <span className="unread-dot" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
