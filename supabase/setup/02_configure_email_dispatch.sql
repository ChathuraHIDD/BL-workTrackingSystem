-- =====================================================================
-- Run in Supabase → SQL Editor AFTER the app is deployed to Vercel.
-- Lets the database's scheduler (pg_cron + pg_net) call the e-mail
-- dispatcher every 15 minutes, even when nobody has the website open.
--
-- Replace both values. The secret MUST equal the CRON_SECRET environment
-- variable configured in Vercel. It is stored in a private schema that the
-- API cannot read.
-- =====================================================================
select private.configure_dispatch(
  'https://YOUR-APP.vercel.app/api/cron/dispatch',
  'PASTE-YOUR-CRON_SECRET-HERE'
);

-- Verify the scheduled jobs exist:
select jobname, schedule, active from cron.job where jobname like 'ble-%';

-- Optional: check recent runs and HTTP responses
-- select * from cron.job_run_details order by start_time desc limit 10;
-- select id, status_code, content::text, created from net._http_response order by created desc limit 10;
