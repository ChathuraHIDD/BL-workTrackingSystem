-- =====================================================================
-- Run ONCE in Supabase → SQL Editor after the migrations, to create the
-- first administrator. Afterwards, invite everyone else from the app
-- (Administration → User accounts).
--
-- Before running:
--   1. Supabase → Authentication → Users → "Add user" → "Create new user"
--      Enter the admin's email + a strong password, tick "Auto Confirm User".
--   2. Replace the three values below.
-- =====================================================================
do $$
declare
  v_email      text := 'admin@batterylab.lk';          -- ← same email as the auth user
  v_full_name  text := 'System Administrator';         -- ← their name
  v_department text := 'Management';                   -- ← one of the departments
  v_user_id    uuid;
  v_emp_id     uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(v_email);
  if v_user_id is null then
    raise exception 'No auth user with email %. Create it first under Authentication → Users.', v_email;
  end if;

  insert into public.employees (full_name, department_id, email, job_title)
  values (v_full_name, (select id from public.departments where name = v_department), lower(v_email), 'Administrator')
  on conflict (email) do update set full_name = excluded.full_name
  returning id into v_emp_id;

  insert into public.app_users (user_id, employee_id, role, is_active)
  values (v_user_id, v_emp_id, 'admin', true)
  on conflict (user_id) do update set role = 'admin', is_active = true, employee_id = excluded.employee_id;

  raise notice 'Administrator ready: % (%)', v_full_name, v_email;
end $$;
