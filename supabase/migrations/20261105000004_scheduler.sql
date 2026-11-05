-- =====================================================================
-- Migration 004: scheduled reminders (pg_cron) + e-mail dispatch (pg_net)
--
-- * In-app reminders are generated INSIDE the database every 15 minutes.
--   generate_due_reminders() only acts once local Asia/Colombo time has
--   reached app_settings.reminder_time and is idempotent (dedupe keys), so
--   frequent runs never create duplicates.
-- * E-mail delivery is performed by the Vercel function
--   /api/cron/dispatch, which pg_net calls every 15 minutes once you have
--   saved its URL + secret with private.configure_dispatch(...) — see README.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.dispatch_config (
  id          boolean primary key default true check (id),
  url         text not null,
  secret      text not null,
  updated_at  timestamptz not null default now()
);
revoke all on private.dispatch_config from public, anon, authenticated;

create or replace function private.configure_dispatch(p_url text, p_secret text)
returns void language sql security definer set search_path = private as $$
  insert into private.dispatch_config (id, url, secret) values (true, p_url, p_secret)
  on conflict (id) do update set url = excluded.url, secret = excluded.secret, updated_at = now();
$$;
revoke execute on function private.configure_dispatch(text, text) from public, anon, authenticated;

create or replace function private.trigger_email_dispatch()
returns void language plpgsql security definer set search_path = private, public as $$
declare c private.dispatch_config;
begin
  select * into c from private.dispatch_config;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.notification_deliveries where status in ('pending', 'sending')) then
    return;  -- nothing queued, skip the HTTP call
  end if;
  perform net.http_post(
    url     := c.url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || c.secret),
    body    := '{"source":"pg_cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
revoke execute on function private.trigger_email_dispatch() from public, anon, authenticated;

-- Schedule jobs when pg_cron / pg_net are available (always true on Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      create extension if not exists pg_net;
    end if;

    perform cron.unschedule(jobname) from cron.job
      where jobname in ('ble-generate-reminders', 'ble-dispatch-emails');

    perform cron.schedule('ble-generate-reminders', '*/15 * * * *',
      $job$select public.generate_due_reminders(false)$job$);

    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule('ble-dispatch-emails', '*/15 * * * *',
        $job$select private.trigger_email_dispatch()$job$);
    end if;
  else
    raise notice 'pg_cron not available: schedule generate_due_reminders() manually.';
  end if;
end $$;
