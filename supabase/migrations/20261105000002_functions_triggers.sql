-- =====================================================================
-- Migration 002: helper functions, audit triggers, notification engine
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity helpers (SECURITY DEFINER so RLS policies can call them
-- without recursive policy evaluation)
-- ---------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.app_users where user_id = auth.uid() and is_active;
$$;

create or replace function public.current_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select employee_id from public.app_users where user_id = auth.uid() and is_active;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'manager'), false);
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_app_role() is not null;
$$;

create or replace function public.is_task_member(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.primary_employee_id = public.current_employee_id()
  ) or exists (
    select 1 from public.task_collaborators c
    where c.task_id = p_task_id
      and c.employee_id = public.current_employee_id()
  );
$$;

create or replace function public.can_view_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_staff() or public.is_task_member(p_task_id);
$$;

create or replace function public.actor_display_name()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select e.full_name from public.app_users u
       join public.employees e on e.id = u.employee_id
      where u.user_id = auth.uid()),
    (select email from auth.users where id = auth.uid()),
    'System'
  );
$$;

create or replace function public.colombo_today()
returns date
language sql stable
as $$
  select (now() at time zone 'Asia/Colombo')::date;
$$;

-- Format a date for messages, e.g. "Fri, 07 Nov 2026"
create or replace function public.fmt_date(d date)
returns text
language sql immutable
as $$
  select to_char(d, 'Dy, DD Mon YYYY');
$$;

-- ---------------------------------------------------------------------
-- Generic updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger app_users_touch before update on public.app_users
  for each row execute function public.touch_updated_at();
create trigger deliveries_touch before update on public.notification_deliveries
  for each row execute function public.touch_updated_at();

-- Employees: record deactivation time
create or replace function public.employees_before_write()
returns trigger language plpgsql as $$
begin
  new.full_name := btrim(new.full_name);
  new.email := lower(btrim(new.email::text));
  new.job_title := nullif(btrim(coalesce(new.job_title, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if not new.is_active then new.deactivated_at := now(); end if;
  elsif new.is_active is distinct from old.is_active then
    new.deactivated_at := case when new.is_active then null else now() end;
  end if;
  return new;
end $$;

create trigger employees_before_write before insert or update on public.employees
  for each row execute function public.employees_before_write();

-- Keep at least one active administrator
create or replace function public.app_users_guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.is_active)
     or (tg_op = 'UPDATE' and old.role = 'admin' and old.is_active
         and (new.role <> 'admin' or not new.is_active)) then
    if not exists (select 1 from public.app_users
                    where role = 'admin' and is_active and user_id <> old.user_id) then
      raise exception 'At least one active administrator account must remain.'
        using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger app_users_guard_last_admin before update or delete on public.app_users
  for each row execute function public.app_users_guard_last_admin();

-- ---------------------------------------------------------------------
-- Notification engine
-- ---------------------------------------------------------------------
create or replace function public.enqueue_notification(
  p_employee_id uuid,
  p_task_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_dedupe_key text default null,
  p_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_email text;
  v_active boolean;
  v_email_enabled boolean;
begin
  select email::text, is_active into v_email, v_active
    from public.employees where id = p_employee_id;
  if not found or not v_active then
    return null;  -- never notify deactivated employees
  end if;

  insert into public.notifications
    (recipient_employee_id, task_id, kind, title, body, dedupe_key, meta)
  values
    (p_employee_id, p_task_id, p_kind, p_title, p_body, p_dedupe_key, coalesce(p_meta, '{}'::jsonb))
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    return null;  -- duplicate reminder suppressed
  end if;

  select email_notifications_enabled into v_email_enabled from public.app_settings;
  if coalesce(v_email_enabled, false) and v_email is not null then
    insert into public.notification_deliveries (notification_id, recipient_email)
    values (v_id, v_email);
  end if;

  return v_id;
end $$;

-- Cancel queued (not yet sent) reminder e-mails that no longer apply
create or replace function public.cancel_pending_reminders(
  p_task_id uuid,
  p_employee_id uuid default null,
  p_reason text default 'Task changed before delivery'
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.notification_deliveries d
     set status = 'cancelled', last_error = p_reason
    from public.notifications n
   where n.id = d.notification_id
     and n.task_id = p_task_id
     and n.kind = 'due_reminder'
     and (p_employee_id is null or n.recipient_employee_id = p_employee_id)
     and d.status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Task triggers: reference number, department snapshot, completion,
-- audit trail and event notifications
-- ---------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.title := btrim(new.title);
  new.description := coalesce(new.description, '');

  if tg_op = 'INSERT' then
    new.reference_no := 'BLE-' || to_char(now() at time zone 'Asia/Colombo', 'YYYY') || '-'
                        || lpad(nextval('public.task_reference_seq')::text, 5, '0');
    new.created_at := now();
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := public.actor_display_name();
  else
    new.reference_no := old.reference_no;   -- immutable
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();

  -- department snapshot follows the primary employee at assignment time
  if tg_op = 'INSERT' or new.primary_employee_id is distinct from old.primary_employee_id then
    select department_id into new.department_id
      from public.employees where id = new.primary_employee_id;
  else
    new.department_id := old.department_id;
  end if;

  -- automatic completion timestamp
  if new.status = 'Completed' then
    if tg_op = 'INSERT' or old.status <> 'Completed' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;

  -- archive timestamp
  if new.is_archived then
    if tg_op = 'INSERT' or not old.is_archived then
      new.archived_at := now();
      new.archived_by := auth.uid();
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_at := null;
    new.archived_by := null;
  end if;

  return new;
end $$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create or replace function public.log_task_activity(
  p_task_id uuid, p_action text, p_field text default null,
  p_old text default null, p_new text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.task_activity (task_id, action, field, old_value, new_value, actor_user_id, actor_name)
  values (p_task_id, p_action, p_field, p_old, p_new, auth.uid(), public.actor_display_name());
$$;

create or replace function public.employee_name(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.employees where id = p_id;
$$;

create or replace function public.tasks_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor_emp uuid := public.current_employee_id();
  r record;
begin
  if tg_op = 'INSERT' then
    perform public.log_task_activity(new.id, 'created', null, null,
      format('%s — primary: %s, due %s, priority %s, status %s',
             new.title, public.employee_name(new.primary_employee_id),
             public.fmt_date(new.due_date), new.priority, new.status));
    if new.primary_employee_id is distinct from v_actor_emp then
      perform public.enqueue_notification(new.primary_employee_id, new.id, 'assigned',
        format('New assignment: %s', new.reference_no),
        format('You are the primary responsible employee for "%s". Due %s. Priority: %s.',
               new.title, public.fmt_date(new.due_date), new.priority),
        null, jsonb_build_object('role', 'primary', 'due_date', new.due_date));
    end if;
    return new;
  end if;

  -- UPDATE: field-by-field audit
  if new.title is distinct from old.title then
    perform public.log_task_activity(new.id, 'edited', 'title', old.title, new.title);
  end if;
  if new.description is distinct from old.description then
    perform public.log_task_activity(new.id, 'edited', 'description', null, null);
  end if;
  if new.priority is distinct from old.priority then
    perform public.log_task_activity(new.id, 'priority_changed', 'priority', old.priority::text, new.priority::text);
  end if;
  if new.primary_employee_id is distinct from old.primary_employee_id then
    perform public.log_task_activity(new.id, 'reassigned', 'primary_employee',
      public.employee_name(old.primary_employee_id), public.employee_name(new.primary_employee_id));
    perform public.cancel_pending_reminders(new.id, old.primary_employee_id, 'Primary employee reassigned');
    if new.primary_employee_id is distinct from v_actor_emp then
      perform public.enqueue_notification(new.primary_employee_id, new.id, 'assigned',
        format('Assigned to you: %s', new.reference_no),
        format('You are now the primary responsible employee for "%s". Due %s.',
               new.title, public.fmt_date(new.due_date)),
        null, jsonb_build_object('role', 'primary', 'due_date', new.due_date));
    end if;
  end if;
  if new.due_date is distinct from old.due_date then
    perform public.log_task_activity(new.id, 'due_date_changed', 'due_date',
      old.due_date::text, new.due_date::text);
    perform public.cancel_pending_reminders(new.id, null, 'Due date changed');
    if new.status <> 'Completed' and not new.is_archived then
      for r in
        select new.primary_employee_id as employee_id
        union
        select employee_id from public.task_collaborators where task_id = new.id
      loop
        -- a newly assigned primary already received an assignment notice with the new date
        if r.employee_id is distinct from v_actor_emp
           and not (r.employee_id = new.primary_employee_id
                    and new.primary_employee_id is distinct from old.primary_employee_id) then
          perform public.enqueue_notification(r.employee_id, new.id, 'due_date_changed',
            format('Due date changed: %s', new.reference_no),
            format('"%s" is now due %s (previously %s).',
                   new.title, public.fmt_date(new.due_date), public.fmt_date(old.due_date)),
            null, jsonb_build_object('old_due_date', old.due_date, 'due_date', new.due_date));
        end if;
      end loop;
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'Completed' then
      perform public.log_task_activity(new.id, 'completed', 'status', old.status::text, new.status::text);
      perform public.cancel_pending_reminders(new.id, null, 'Task completed');
    elsif old.status = 'Completed' then
      perform public.log_task_activity(new.id, 'reopened', 'status', old.status::text, new.status::text);
    else
      perform public.log_task_activity(new.id, 'status_changed', 'status', old.status::text, new.status::text);
    end if;
  end if;
  if new.is_archived is distinct from old.is_archived then
    if new.is_archived then
      perform public.log_task_activity(new.id, 'archived');
      perform public.cancel_pending_reminders(new.id, null, 'Task archived');
    else
      perform public.log_task_activity(new.id, 'restored');
    end if;
  end if;
  return new;
end $$;

create trigger tasks_after_write after insert or update on public.tasks
  for each row execute function public.tasks_after_write();

create or replace function public.task_collaborators_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  if tg_op = 'INSERT' then
    select * into t from public.tasks where id = new.task_id;
    if new.employee_id = t.primary_employee_id then
      raise exception 'The primary employee cannot also be a collaborator.' using errcode = 'P0001';
    end if;
    perform public.log_task_activity(new.task_id, 'collaborator_added', 'collaborator',
      null, public.employee_name(new.employee_id));
    if new.employee_id is distinct from public.current_employee_id()
       and t.status <> 'Completed' and not t.is_archived then
      perform public.enqueue_notification(new.employee_id, new.task_id, 'collaborator_added',
        format('Added as collaborator: %s', t.reference_no),
        format('You have been added as a collaborator on "%s" (primary: %s). Due %s.',
               t.title, public.employee_name(t.primary_employee_id), public.fmt_date(t.due_date)),
        null, jsonb_build_object('role', 'collaborator', 'due_date', t.due_date));
    end if;
    return new;
  else
    -- skip logging when the whole task is being deleted (never happens via app)
    if exists (select 1 from public.tasks where id = old.task_id) then
      perform public.log_task_activity(old.task_id, 'collaborator_removed', 'collaborator',
        public.employee_name(old.employee_id), null);
      perform public.cancel_pending_reminders(old.task_id, old.employee_id, 'Collaborator removed');
    end if;
    return old;
  end if;
end $$;

create trigger task_collaborators_after_write after insert or delete on public.task_collaborators
  for each row execute function public.task_collaborators_after_write();

-- ---------------------------------------------------------------------
-- Application RPCs (validated, transactional, permission-checked)
-- ---------------------------------------------------------------------

-- Create or update a task together with its collaborators in ONE transaction.
create or replace function public.save_task(
  p_id uuid,
  p_title text,
  p_description text,
  p_primary_employee_id uuid,
  p_collaborator_ids uuid[],
  p_due_date date,
  p_priority public.task_priority,
  p_status public.task_status default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_old public.tasks;
  v_collabs uuid[];
begin
  if not public.is_staff() then
    raise exception 'Only managers and administrators can create or edit tasks.' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) < 3 then
    raise exception 'Title must be at least 3 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'Title must be 200 characters or fewer.' using errcode = '22023';
  end if;
  if p_primary_employee_id is null then
    raise exception 'A primary responsible employee is required.' using errcode = '22023';
  end if;
  if p_due_date is null then
    raise exception 'A due date is required.' using errcode = '22023';
  end if;
  if p_priority is null then
    raise exception 'Priority is required.' using errcode = '22023';
  end if;

  v_collabs := array(
    select distinct x from unnest(coalesce(p_collaborator_ids, '{}')) x
     where x is not null and x <> p_primary_employee_id
  );

  if p_id is not null then
    select * into v_old from public.tasks where id = p_id for update;
    if not found then
      raise exception 'Task not found.' using errcode = 'P0002';
    end if;
    if v_old.is_archived then
      raise exception 'Archived tasks must be restored before editing.' using errcode = 'P0001';
    end if;
  end if;

  -- newly assigned people must be active employees
  if (v_old.id is null or v_old.primary_employee_id <> p_primary_employee_id)
     and not exists (select 1 from public.employees where id = p_primary_employee_id and is_active) then
    raise exception 'The primary employee must be an active employee.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_collabs) x
     where not exists (select 1 from public.employees e where e.id = x and e.is_active)
       and (v_old.id is null or not exists (
            select 1 from public.task_collaborators c where c.task_id = v_old.id and c.employee_id = x))
  ) then
    raise exception 'Collaborators must be active employees.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.tasks (title, description, primary_employee_id, due_date, priority, status)
    values (p_title, coalesce(p_description, ''), p_primary_employee_id, p_due_date, p_priority,
            coalesce(p_status, 'Not Started'))
    returning id into v_id;
  else
    v_id := p_id;
    -- remove a collaborator who has become primary BEFORE switching primary
    delete from public.task_collaborators
     where task_id = v_id and (employee_id = p_primary_employee_id or not (employee_id = any (v_collabs)));
    update public.tasks set
      title = p_title,
      description = coalesce(p_description, ''),
      primary_employee_id = p_primary_employee_id,
      due_date = p_due_date,
      priority = p_priority,
      status = coalesce(p_status, status)
    where id = v_id;
  end if;

  insert into public.task_collaborators (task_id, employee_id, added_by)
  select v_id, x, auth.uid() from unnest(v_collabs) x
  on conflict do nothing;

  return v_id;
end $$;

-- Update status (employees: primary owner only, cannot reopen completed work)
create or replace function public.set_task_status(
  p_task_id uuid,
  p_status public.task_status,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.tasks;
begin
  if not public.is_active_user() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into t from public.tasks where id = p_task_id for update;
  if not found or not public.can_view_task(p_task_id) then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  if t.is_archived then
    raise exception 'Archived tasks cannot be changed.' using errcode = 'P0001';
  end if;
  if not public.is_staff() then
    if t.primary_employee_id is distinct from public.current_employee_id() then
      raise exception 'Only the primary responsible employee or a manager can change the status. Collaborators can add progress updates.'
        using errcode = '42501';
    end if;
    if t.status = 'Completed' and p_status <> 'Completed' then
      raise exception 'Completed tasks can only be reopened by a manager or administrator.'
        using errcode = '42501';
    end if;
  end if;

  if t.status is distinct from p_status then
    update public.tasks set status = p_status where id = p_task_id;
  end if;

  if p_note is not null and char_length(btrim(p_note)) > 0 then
    perform public.add_task_comment(p_task_id, p_note, 'progress');
  end if;
end $$;

create or replace function public.archive_task(p_task_id uuid, p_archive boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Only managers and administrators can archive tasks.' using errcode = '42501';
  end if;
  update public.tasks set is_archived = p_archive where id = p_task_id;
  if not found then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.add_task_comment(p_task_id uuid, p_body text, p_kind text default 'comment')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_active_user() or not public.can_view_task(p_task_id) then
    raise exception 'Not authorised to comment on this task.' using errcode = '42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'Comment cannot be empty.' using errcode = '22023';
  end if;
  if char_length(p_body) > 5000 then
    raise exception 'Comment must be 5000 characters or fewer.' using errcode = '22023';
  end if;
  if p_kind not in ('comment', 'progress') then
    raise exception 'Invalid comment type.' using errcode = '22023';
  end if;
  insert into public.task_comments (task_id, kind, body, author_user_id, author_employee_id, author_name)
  values (p_task_id, p_kind, btrim(p_body), auth.uid(), public.current_employee_id(), public.actor_display_name())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.notifications
     set is_read = true, read_at = now()
   where recipient_employee_id = public.current_employee_id()
     and not is_read
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Scheduled reminder generation (run by pg_cron; idempotent)
-- ---------------------------------------------------------------------
create or replace function public.generate_due_reminders(p_force boolean default false)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_now   timestamp := now() at time zone 'Asia/Colombo';
  v_today date := v_now::date;
  s       public.app_settings;
  r       record;
  v_count integer := 0;
begin
  select * into s from public.app_settings;
  if not p_force and v_now::time < s.reminder_time then
    return 0;   -- not yet reminder time today (Asia/Colombo)
  end if;

  for r in
    select t.id, t.reference_no, t.title, t.due_date, t.priority,
           a.employee_id, a.role, (t.due_date - v_today) as days_left
      from public.tasks t
      cross join lateral (
        select t.primary_employee_id as employee_id, 'primary'::text as role
        union all
        select c.employee_id, 'collaborator' from public.task_collaborators c where c.task_id = t.id
      ) a
     where not t.is_archived
       and t.status <> 'Completed'
       and (t.due_date - v_today) = any (s.reminder_days_before)
  loop
    if public.enqueue_notification(
         r.employee_id, r.id, 'due_reminder',
         format('%s due %s: %s', r.reference_no,
                case when r.days_left = 1 then 'tomorrow' else format('in %s days', r.days_left) end,
                r.title),
         format('Reminder: "%s" is due %s (%s). You are the %s. Priority: %s.',
                r.title, public.fmt_date(r.due_date),
                case when r.days_left = 1 then 'tomorrow' else format('in %s days', r.days_left) end,
                case when r.role = 'primary' then 'primary responsible employee' else 'a collaborator' end,
                r.priority),
         format('reminder:%s:%s:%s:%s', r.id, r.employee_id, r.due_date, r.days_left),
         jsonb_build_object('due_date', r.due_date, 'days_before', r.days_left, 'role', r.role)
       ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  update public.app_settings set last_reminder_run_at = now();
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- E-mail delivery queue (used by the server-side dispatcher only)
-- ---------------------------------------------------------------------
create or replace function public.cancel_invalid_deliveries()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer; v_more integer;
begin
  -- reminders whose task is finished/archived, due date moved, or recipient unassigned
  update public.notification_deliveries d
     set status = 'cancelled', last_error = 'No longer applicable at send time'
    from public.notifications n
    left join public.tasks t on t.id = n.task_id
   where n.id = d.notification_id
     and d.status = 'pending'
     and n.kind = 'due_reminder'
     and (t.id is null
          or t.status = 'Completed'
          or t.is_archived
          or t.due_date::text <> n.meta->>'due_date'
          or (n.recipient_employee_id <> t.primary_employee_id
              and not exists (select 1 from public.task_collaborators c
                               where c.task_id = t.id and c.employee_id = n.recipient_employee_id)));
  get diagnostics v_count = row_count;

  -- deactivated recipients, or messages stuck for more than 3 days
  update public.notification_deliveries d
     set status = 'cancelled',
         last_error = case when d.created_at < now() - interval '3 days'
                           then 'Expired before delivery' else 'Recipient deactivated' end
    from public.notifications n
    join public.employees e on e.id = n.recipient_employee_id
   where n.id = d.notification_id
     and d.status = 'pending'
     and (not e.is_active or d.created_at < now() - interval '3 days');
  get diagnostics v_more = row_count;
  return v_count + v_more;
end $$;

create or replace function public.claim_email_deliveries(p_limit integer default 50)
returns table (
  delivery_id uuid, recipient_email text, recipient_name text,
  kind text, title text, body text, task_id uuid, reference_no text, attempts integer
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with c as (
    select d.id
      from public.notification_deliveries d
     where (d.status = 'pending' and d.next_attempt_at <= now())
        or (d.status = 'sending' and d.last_attempt_at < now() - interval '10 minutes')
     order by d.created_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  ), u as (
    update public.notification_deliveries d
       set status = 'sending', attempts = d.attempts + 1, last_attempt_at = now()
      from c where d.id = c.id
    returning d.id, d.notification_id, d.recipient_email, d.attempts
  )
  select u.id, u.recipient_email, e.full_name, n.kind, n.title, n.body, n.task_id, t.reference_no, u.attempts
    from u
    join public.notifications n on n.id = u.notification_id
    join public.employees e on e.id = n.recipient_employee_id
    left join public.tasks t on t.id = n.task_id;
end $$;

create or replace function public.complete_email_delivery(
  p_delivery_id uuid, p_success boolean, p_error text default null, p_provider_id text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_attempts integer;
begin
  insert into public.notification_delivery_attempts (delivery_id, success, error, provider_message_id)
  values (p_delivery_id, p_success, left(p_error, 2000), p_provider_id);

  if p_success then
    update public.notification_deliveries
       set status = 'sent', sent_at = now(), provider_message_id = p_provider_id, last_error = null
     where id = p_delivery_id;
  else
    select attempts into v_attempts from public.notification_deliveries where id = p_delivery_id;
    update public.notification_deliveries
       set status = case when v_attempts >= 5 then 'failed' else 'pending' end,
           next_attempt_at = now() + make_interval(mins => 15 * v_attempts),
           last_error = left(p_error, 2000)
     where id = p_delivery_id;
  end if;
end $$;
