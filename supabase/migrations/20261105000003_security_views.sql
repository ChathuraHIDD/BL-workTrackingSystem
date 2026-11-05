-- =====================================================================
-- Migration 003: row level security, privileges, views, dashboard
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------
alter table public.departments                    enable row level security;
alter table public.employees                      enable row level security;
alter table public.app_users                      enable row level security;
alter table public.app_settings                   enable row level security;
alter table public.tasks                          enable row level security;
alter table public.task_collaborators             enable row level security;
alter table public.task_comments                  enable row level security;
alter table public.task_activity                  enable row level security;
alter table public.notifications                  enable row level security;
alter table public.notification_deliveries        enable row level security;
alter table public.notification_delivery_attempts enable row level security;

-- ---------------------------------------------------------------------
-- Table privileges: nothing for anonymous visitors; business records
-- are only written through validated SECURITY DEFINER functions.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke insert, update, delete, truncate on
  public.tasks, public.task_collaborators, public.task_comments, public.task_activity,
  public.notifications, public.notification_deliveries, public.notification_delivery_attempts
  from authenticated;
revoke delete, truncate on public.employees, public.departments, public.app_settings from authenticated;
revoke usage on sequence public.task_reference_seq from authenticated;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------
-- departments
create policy departments_select on public.departments
  for select to authenticated using ((select public.is_active_user()));
create policy departments_admin_insert on public.departments
  for insert to authenticated with check ((select public.is_admin()));
create policy departments_admin_update on public.departments
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- employees (everyone signed in can see names; only admins change records)
create policy employees_select on public.employees
  for select to authenticated using ((select public.is_active_user()));
create policy employees_admin_insert on public.employees
  for insert to authenticated with check ((select public.is_admin()));
create policy employees_admin_update on public.employees
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- login accounts
create policy app_users_select on public.app_users
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy app_users_admin_update on public.app_users
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke insert, delete, truncate on public.app_users from authenticated; -- created server-side only

-- settings
create policy app_settings_select on public.app_settings
  for select to authenticated using ((select public.is_active_user()));
create policy app_settings_admin_update on public.app_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- tasks and children: staff see everything, employees see their own work
create policy tasks_select on public.tasks
  for select to authenticated
  using ((select public.is_staff())
         or primary_employee_id = (select public.current_employee_id())
         or public.is_task_member(id));

create policy task_collaborators_select on public.task_collaborators
  for select to authenticated
  using ((select public.is_staff()) or public.is_task_member(task_id));

create policy task_comments_select on public.task_comments
  for select to authenticated
  using ((select public.is_staff()) or public.is_task_member(task_id));

create policy task_activity_select on public.task_activity
  for select to authenticated
  using ((select public.is_staff()) or public.is_task_member(task_id));

-- notifications: recipients see their own; admins can audit everything
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_employee_id = (select public.current_employee_id()) or (select public.is_admin()));

create policy notification_deliveries_admin_select on public.notification_deliveries
  for select to authenticated using ((select public.is_admin()));

create policy notification_delivery_attempts_admin_select on public.notification_delivery_attempts
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- Function privileges: internal engine functions are server-only
-- ---------------------------------------------------------------------
revoke execute on function
  public.enqueue_notification(uuid, uuid, text, text, text, text, jsonb),
  public.cancel_pending_reminders(uuid, uuid, text),
  public.log_task_activity(uuid, text, text, text, text),
  public.generate_due_reminders(boolean),
  public.cancel_invalid_deliveries(),
  public.claim_email_deliveries(integer),
  public.complete_email_delivery(uuid, boolean, text, text)
  from public, anon, authenticated;

grant execute on function
  public.generate_due_reminders(boolean),
  public.cancel_invalid_deliveries(),
  public.claim_email_deliveries(integer),
  public.complete_email_delivery(uuid, boolean, text, text)
  to service_role;

revoke execute on function
  public.save_task(uuid, text, text, uuid, uuid[], date, public.task_priority, public.task_status),
  public.set_task_status(uuid, public.task_status, text),
  public.archive_task(uuid, boolean),
  public.add_task_comment(uuid, text, text),
  public.mark_notifications_read(uuid[])
  from public, anon;

grant execute on function
  public.save_task(uuid, text, text, uuid, uuid[], date, public.task_priority, public.task_status),
  public.set_task_status(uuid, public.task_status, text),
  public.archive_task(uuid, boolean),
  public.add_task_comment(uuid, text, text),
  public.mark_notifications_read(uuid[])
  to authenticated;

-- ---------------------------------------------------------------------
-- Read models (security_invoker → caller's RLS applies)
-- ---------------------------------------------------------------------
create view public.task_overview with (security_invoker = true) as
select
  t.id,
  t.reference_no,
  t.title,
  t.description,
  t.primary_employee_id,
  pe.full_name                     as primary_employee_name,
  pe.email::text                   as primary_employee_email,
  pe.is_active                     as primary_employee_active,
  t.department_id,
  d.name                           as department_name,
  coalesce(c.ids, '{}')            as collaborator_ids,
  coalesce(c.names, '{}')          as collaborator_names,
  coalesce(c.names_text, '')       as collaborator_names_text,
  coalesce(c.details, '[]'::jsonb) as collaborators,
  t.due_date,
  t.priority,
  case t.priority when 'High' then 1 when 'Medium' then 2 else 3 end as priority_rank,
  t.status,
  (t.status <> 'Completed' and not t.is_archived and t.due_date < public.colombo_today()) as is_overdue,
  t.completed_at,
  t.is_archived,
  t.archived_at,
  t.created_at,
  t.created_by,
  t.created_by_name,
  t.updated_at
from public.tasks t
join public.employees pe  on pe.id = t.primary_employee_id
join public.departments d on d.id  = t.department_id
left join lateral (
  select array_agg(e.id order by e.full_name)        as ids,
         array_agg(e.full_name order by e.full_name) as names,
         string_agg(e.full_name, ', ' order by e.full_name) as names_text,
         jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name,
                                      'department', ed.name, 'is_active', e.is_active)
                   order by e.full_name) as details
    from public.task_collaborators tc
    join public.employees e    on e.id = tc.employee_id
    join public.departments ed on ed.id = e.department_id
   where tc.task_id = t.id
) c on true;

create view public.activity_feed with (security_invoker = true) as
select a.id, a.task_id, t.reference_no, t.title as task_title,
       a.action, a.field, a.old_value, a.new_value, a.actor_name, a.created_at
  from public.task_activity a
  join public.tasks t on t.id = a.task_id;

create view public.employee_directory with (security_invoker = true) as
select e.id, e.full_name, e.department_id, d.name as department_name, e.job_title,
       e.email::text as email, e.is_active, e.deactivated_at, e.created_at, e.updated_at
  from public.employees e
  join public.departments d on d.id = e.department_id;

revoke all on public.task_overview, public.activity_feed, public.employee_directory from anon;
grant select on public.task_overview, public.activity_feed, public.employee_directory to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard metrics (live; respects the caller's visibility)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_summary(p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with base as (
    select * from public.task_overview where not is_archived
  ), wk as (
    select date_trunc('week', public.colombo_today())::date as ws
  ), open_tasks as (
    select * from base where status <> 'Completed'
  )
  select jsonb_build_object(
    'today',          public.colombo_today(),
    'week_start',     (select ws from wk),
    'week_end',       (select ws + 6 from wk),
    'total_active',   (select count(*) from open_tasks),
    'in_progress',    (select count(*) from open_tasks where status = 'In Progress'),
    'on_hold',        (select count(*) from open_tasks where status = 'On Hold'),
    'not_started',    (select count(*) from open_tasks where status = 'Not Started'),
    'due_this_week',  (select count(*) from open_tasks, wk where due_date between wk.ws and wk.ws + 6),
    'overdue',        (select count(*) from open_tasks where is_overdue),
    'completed_in_period', (
       select count(*) from base
        where completed_at >= (p_from::timestamp at time zone 'Asia/Colombo')
          and completed_at <  ((p_to + 1)::timestamp at time zone 'Asia/Colombo')),
    'by_department', coalesce((
       select jsonb_agg(x order by x.open_count desc, x.department)
         from (select department_name as department, count(*) as open_count,
                      count(*) filter (where is_overdue) as overdue_count
                 from open_tasks group by department_name) x), '[]'::jsonb),
    'by_employee', coalesce((
       select jsonb_agg(x order by x.primary_count + x.collaborator_count desc, x.name)
         from (select e.id, e.full_name as name, d.name as department,
                      count(*) filter (where o.primary_employee_id = e.id) as primary_count,
                      count(*) filter (where o.primary_employee_id <> e.id) as collaborator_count,
                      count(*) filter (where o.is_overdue) as overdue_count
                 from public.employees e
                 join public.departments d on d.id = e.department_id
                 join open_tasks o on o.primary_employee_id = e.id or e.id = any (o.collaborator_ids)
                where e.is_active
                group by e.id, e.full_name, d.name) x), '[]'::jsonb)
  );
$$;

revoke execute on function public.dashboard_summary(date, date) from public, anon;
grant execute on function public.dashboard_summary(date, date) to authenticated;
