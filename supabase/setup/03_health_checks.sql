-- Useful read-only queries for administrators (Supabase → SQL Editor)

-- Reminder generation status
select reminder_time, reminder_days_before, email_notifications_enabled, last_reminder_run_at
from public.app_settings;

-- E-mail queue overview
select status, count(*) from public.notification_deliveries group by status order by status;

-- Recent delivery failures
select d.created_at, d.recipient_email, d.attempts, d.last_error, n.title
from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
where d.status = 'failed' order by d.created_at desc limit 20;

-- Record counts (useful before/after a backup restore)
select (select count(*) from public.tasks) as tasks,
       (select count(*) from public.employees) as employees,
       (select count(*) from public.task_comments) as comments,
       (select count(*) from public.task_activity) as audit_entries,
       (select count(*) from public.notifications) as notifications;
