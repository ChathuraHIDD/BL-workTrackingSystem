# Battery Lab Energy — Workload & Task Tracking System

A web application that replaces the Excel workbook for assigning office work, tracking progress and workloads, and exporting accurate reports.

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript (responsive, accessible) |
| Hosting | Vercel (static site + serverless functions + daily cron) |
| Database & auth | Supabase PostgreSQL with Row Level Security, Supabase Auth |
| Scheduling | `pg_cron` inside the database (every 15 min) + Vercel Cron (daily safety net) |
| Email | Resend (HTTP API), with every attempt and failure logged in the database |
| Exports | Excel `.xlsx` (SheetJS) and CSV, generated from live database records |

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Setup (step by step)](#setup-step-by-step)
4. [Environment variables](#environment-variables)
5. [Local development](#local-development)
6. [Roles and permissions](#roles-and-permissions)
7. [How reminders work](#how-reminders-work)
8. [Reports: what each one counts](#reports-what-each-one-counts)
9. [Data integrity and audit trail](#data-integrity-and-audit-trail)
10. [Backup and restore](#backup-and-restore)
11. [Branding](#branding)
12. [Troubleshooting](#troubleshooting)
13. [Project structure](#project-structure)

---

## Features

- **Work records** with an automatic reference number (`BLE-2026-00001`), title, description, one **primary responsible employee**, optional **collaborators**, due date, priority, status, creator, and timestamps. The completion time is recorded automatically. Records are archived rather than deleted.
- **Automatic overdue status:** a task is overdue when the Asia/Colombo date is past its due date and it is not completed.
- **All Work Records page** with search (title, reference, description, employee), filters (employee and their involvement, department, priority, status, overdue, date range by due, completion or creation date, archived), sorting, pagination, and quick views: *All Tasks, Due This Week, Overdue, In Progress, Completed*. Filters are kept in the URL, so a filtered view can be bookmarked or shared.
- **Task detail page** with comments, progress updates, and a full activity history.
- **Employees:** add, edit, view, deactivate, and reactivate. Each profile page shows primary and collaborative tasks, active, upcoming, overdue, and completed work, summary counts, date filters, and Excel/CSV downloads.
- **Reports:** tasks due in a date range, tasks completed in a date range, and employee workload and completion summaries.
- **Notifications:** an in-app notification centre (read/unread, links to the task) plus email. Employees are notified about new assignments, being added as a collaborator, due-date changes, and reminders 2 days and 1 day before the due date.
- **Dashboard:** live metrics that open the matching filtered task list, workload by employee (primary vs collaborator) and by department, upcoming deadlines, and recent activity.
- **Administration:** invite-only user accounts and roles, the reminder schedule, departments, and an email delivery log.

## Architecture

```
Browser (React SPA) ──anon key + user JWT──▶ Supabase PostgREST ──▶ PostgreSQL
   │                                             (Row Level Security on every table;
   │                                              writes go through validated SQL functions)
   │
   └──user JWT──▶ Vercel function /api/admin/accounts ──service role──▶ Supabase Auth admin API
                                                                          (invite / disable / reset)

PostgreSQL pg_cron (every 15 min) ──▶ generate_due_reminders()          (in-app reminders, no HTTP)
PostgreSQL pg_cron + pg_net (15 min) ─┐
Vercel Cron (daily 09:15 Colombo) ────┴─▶ /api/cron/dispatch ──▶ Resend email API
                                           (claims queued emails with row locks, retries, logs every attempt)
```

**Why Supabase?** It is a managed PostgreSQL database with authentication, Row Level Security, scheduled jobs (`pg_cron`), and backups built in. It has a first-party Vercel integration that sets the environment variables for you. The browser only ever holds the public *anon/publishable* key. The *service role* key lives only in Vercel's server-side environment.

**Where the business rules live.** They are enforced **in the database**, so they cannot be bypassed from the browser:

- `save_task`, `set_task_status`, `archive_task` and `add_task_comment` are validated, permission-checked, transactional SQL functions. Clients cannot insert, update or delete tasks directly.
- Triggers generate reference numbers, snapshot the department, stamp completion and archive times, write the audit trail, and create notifications.
- Row Level Security limits employees to their own tasks and lets only administrators change employees, departments, accounts and settings.

## Setup (step by step)

Allow about 30–45 minutes for the first deployment.

### 1. Create the Supabase project

1. Sign in at <https://supabase.com> and create a **New project**. Choose the region closest to Sri Lanka, **South Asia (Mumbai)**.
2. Save the database password somewhere secure.
3. Open **Project Settings → API** and note:
   - the **Project URL**,
   - the **anon / publishable** key (public),
   - the **service_role / secret** key (server only — never put it in a `VITE_` variable).

### 2. Create the database schema

Choose **one** of the two options below.

**Option A — Supabase CLI (recommended):**

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push            # applies supabase/migrations/*.sql in order
```

**Option B — SQL Editor:** in Supabase → **SQL Editor**, open and run each file in `supabase/migrations/`, **in filename order**:

1. `20261105000001_core_schema.sql`
2. `20261105000002_functions_triggers.sql`
3. `20261105000003_security_views.sql`
4. `20261105000004_scheduler.sql`

The last file enables `pg_cron` and `pg_net` and schedules the reminder job. If it reports that `pg_cron` is unavailable, enable **pg_cron** and **pg_net** under **Database → Extensions** and run it again.

### 3. Lock down authentication

In Supabase → **Authentication**:

1. **Sign In / Providers → Email:** turn **off** *Allow new users to sign up*. Only administrators can create accounts, through invitations.
2. **URL Configuration:**
   - *Site URL* = your production URL, e.g. `https://ble-tasks.vercel.app`.
   - Add *Redirect URLs* `https://ble-tasks.vercel.app/**` and `http://localhost:5173/**`.
3. **Emails → SMTP Settings:** configure **custom SMTP**. Supabase's built-in sender is rate-limited and meant for testing only, so invitations and password resets will not arrive reliably without it. With Resend, use host `smtp.resend.com`, port `465`, user `resend`, and your Resend API key as the password.
4. Optional: under **Policies / Passwords**, set the minimum password length to 10 (the app already requires 10).

### 4. Create the first administrator

1. **Authentication → Users → Add user → Create new user**: enter the administrator's email and a strong password, and tick **Auto Confirm User**.
2. Open `supabase/setup/01_bootstrap_first_admin.sql`, set the email, name and department at the top, and run it in the **SQL Editor**.

### 5. Set up email (Resend)

1. Create an account at <https://resend.com>.
2. **Domains → Add domain** (e.g. `batterylab.lk`) and add the DNS records it shows. Wait until the domain shows *Verified*.
3. **API Keys → Create API key** (sending access).
4. Choose a sender address on that domain, e.g. `Battery Lab Energy <tasks@batterylab.lk>`.

The app works without email. In-app notifications still appear, and emails wait in the queue (visible in the delivery log) until email is configured. Queued emails that are more than 3 days old are cancelled instead of being sent late.

### 6. Deploy to Vercel

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Vercel, choose **Add New → Project**, import the repository, and keep the detected **Vite** framework. Build settings come from `vercel.json`.
3. Under **Settings → Environment Variables**, add every variable in the [table below](#environment-variables) for *Production*, and for *Preview* if you use preview deployments.
   Alternatively, install the **Supabase integration** from the Vercel marketplace, which sets the Supabase URL and keys automatically; you then add the remaining variables yourself.
4. Deploy. Once it is live, set `APP_URL` to the final URL and redeploy.

> **Cron on the Vercel Hobby plan:** Vercel Cron runs at most once a day on Hobby, so `vercel.json` schedules one daily safety-net run (03:45 UTC = 09:15 Colombo). The main schedule runs inside Supabase every 15 minutes (next step), so a paid Vercel plan is not required.

### 7. Connect the database scheduler to the email dispatcher

Open `supabase/setup/02_configure_email_dispatch.sql`, enter your deployed URL and the **same** `CRON_SECRET` you set in Vercel, then run it in the SQL Editor. The query at the end should list two active jobs: `ble-generate-reminders` and `ble-dispatch-emails`.

To test it straight away:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/cron/dispatch
# → {"ok":true,"remindersCreated":0,"deliveriesCancelled":0,"emailConfigured":true,"sent":0,"failed":0}
```

### 8. Start using it

1. Sign in as the administrator.
2. Go to **Employees → Add employee** and add each person (name, department, job title, email).
3. Go to **Administration → User accounts → Invite user**, choose the employee and a role. They receive an email, choose a password, and can sign in.
4. Managers create tasks from **All Work Records → New task**.

**Moving from Excel:** enter each open item as a task. Past due dates are allowed; such tasks show as overdue immediately.

## Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Browser build | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser build | Yes | Public anon/publishable key. Safe to expose because Row Level Security protects all data |
| `SUPABASE_URL` | Server | Yes | Same project URL, used by `/api` functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | **Secret.** Used only by `/api` functions for account administration and the email queue |
| `CRON_SECRET` | Server | Yes | Long random string (`openssl rand -hex 32`). Authenticates Vercel Cron and `pg_cron` calls to `/api/cron/dispatch` |
| `APP_URL` | Server | Yes | Public URL of the app, used in email links and invitation redirects |
| `RESEND_API_KEY` | Server | For email | Resend API key |
| `EMAIL_FROM` | Server | For email | Verified sender, e.g. `Battery Lab Energy <tasks@batterylab.lk>` |

Copy `.env.example` to `.env.local` for local development. **Never** prefix a secret with `VITE_`: anything with that prefix is bundled into the public JavaScript.

## Local development

```bash
npm install
cp .env.example .env.local     # fill in values (you can point at the production project or a separate dev project)
npm run dev                    # http://localhost:5173 — UI only; /api functions are not served
```

To run the serverless functions locally as well (account invitations, dispatcher), use the Vercel CLI:

```bash
npm install -g vercel
vercel link
vercel dev                     # serves the SPA and /api together
```

Checks:

```bash
npm run typecheck   # frontend + API TypeScript
npm test            # unit tests: Colombo dates, week boundaries, report counting rules
npm run build       # production build
```

A separate Supabase project for development or staging is recommended, so tests never touch live data.

## Roles and permissions

| Capability | Administrator | Manager | Employee |
|---|:-:|:-:|:-:|
| View all tasks, dashboard and company reports | ✓ | ✓ | Own tasks only |
| Create, edit, reassign and archive tasks | ✓ | ✓ | — |
| Change task status | ✓ | ✓ | As **primary** employee; cannot reopen completed tasks |
| Post comments and progress updates | ✓ | ✓ | On tasks where they are primary or collaborator |
| Download summaries | All | All | Their own |
| Add, edit and deactivate employees | ✓ | View only | — |
| Invite accounts, change roles, disable logins | ✓ | — | — |
| Reminder settings, departments, email delivery log | ✓ | — | — |

Employee records and login accounts are separate tables (`employees` and `app_users`), linked one-to-one. Deactivating an employee does not delete their login and vice versa; each is managed on its own screen. At least one active administrator must always exist, and the database enforces this.

## How reminders work

- `generate_due_reminders()` runs **inside the database** every 15 minutes through `pg_cron`. It does nothing until the configured reminder time (default **09:00 Asia/Colombo**, editable under *Administration → Reminders*) has passed for the day.
- For each task that is not completed and not archived and is due in **2 days** or **1 day**, it notifies the primary employee and every collaborator who is still active.
- **No duplicates:** each reminder has a unique key (task + person + due date + days before), so repeated runs, catch-up runs and concurrent runs never send it twice.
- **When things change:**
  - When a due date changes, queued reminder emails for the old date are cancelled and new reminders follow the new date. Assignees also receive a "due date changed" notification.
  - When someone is removed as primary or collaborator, their queued reminders are cancelled.
  - When a task is completed or archived, all of its queued reminders are cancelled.
  - The dispatcher checks every reminder again just before sending, in case anything changed after it was queued.
- **Email delivery:** the dispatcher locks queued emails (`FOR UPDATE SKIP LOCKED`), sends them through Resend with an idempotency key, and records every attempt in `notification_delivery_attempts`. Failures are retried up to 5 times with increasing delays and then marked `failed`. Administrators can see all of this under **Administration → Email delivery log**.

## Reports: what each one counts

All dates are in **Asia/Colombo**. Date ranges are **inclusive**, and a week runs **Monday to Sunday**.

| Report | Date filter | Notes |
|---|---|---|
| Tasks due within a date range | The task's **due date** | Presets: This Week, Next Week, This Month, Next Month, Last Week |
| Tasks completed within a date range | The **actual completion time** (from 00:00 on the start date to 23:59 on the end date, Colombo time) | Includes tasks completed in the range regardless of their original due date |
| Employee workload & completion | Due date, completion date, or no date filter | Filters: employee, employee department, priority, status, archived |

**No double counting.** In the workload report, each employee row counts primary and collaborative work separately. Company totals count each task **once**. The workbook says this on its *Report Info* sheet and contains four sheets: *By Employee*, *Company Totals*, *Tasks (each once)*, and *Assignments by Employee* (one row per person per task, labelled Primary or Collaborator).

Every export includes the reference number, title, primary employee, department, collaborators and their departments, priority, status, overdue flag, due date, completion date and time, on-time or late, created and updated times, and the archived flag. The `.xlsx` file also has a *Report Info* sheet listing the filters used and when the report was generated. CSV files are UTF-8 with a BOM, so Excel opens them correctly.

## Data integrity and audit trail

- **Everything is stored in PostgreSQL.** The browser keeps nothing except the login session, which Supabase manages.
- **Constraints:** foreign keys, length and format checks, a completion-consistency check (`Completed` ⇔ `completed_at` is set), unique reference numbers, unique employee emails, and a rule that the primary employee cannot also be a collaborator.
- **Audit trail (`task_activity`):** records creation, title and description edits, priority changes, due-date changes, status changes, completion, reopening, primary reassignment, collaborators added or removed, archiving, and restoring. Each entry stores who did it (user ID and name) and when. The table is append-only for application users.
- **Comments are append-only.** No one can edit or delete history through the app.
- **History survives:**
  - Tasks keep the **department at the time of assignment**.
  - Deactivated employees remain on all their tasks, reports and history.
  - Archived tasks remain searchable (*Filters → Archived*) and can be included in exports.
- Inputs are validated in the browser for fast feedback and again in the database for enforcement.

## Backup and restore

**What Supabase provides depends on your plan:**

| Plan | Built-in backups |
|---|---|
| Free | No downloadable backups. Projects pause after a week of inactivity. **Not recommended for production.** |
| **Pro (recommended)** | Automatic daily backups, kept for 7 days, restorable from **Database → Backups** |
| Pro + PITR add-on | Point-in-time recovery to any second within the retention window |

**Recommended setup:**

1. Use the **Pro** plan for production.
2. Also keep **independent nightly off-site backups** using the included tooling:
   - `scripts/backup.sh` creates gzip'd `pg_dump` files of business data, schema and login accounts.
   - `.github/workflows/db-backup.yml` runs that script nightly at 01:00 Colombo time and stores the result as a GitHub artifact for 30 days. To enable it, add the repository **secret** `SUPABASE_DB_URL` (from **Project Settings → Database → Connection string → Session pooler**) and the repository **variable** `ENABLE_DB_BACKUP=true`. **Keep the repository private.** For longer retention, download the artifacts monthly.
3. **Practise a restore every quarter:**
   1. Create a new, empty Supabase project.
   2. Apply the migrations to it.
   3. Run `scripts/restore.sh <auth backup> <data backup>`. The script refuses to run against a database that already contains tasks.
   4. Compare record counts using `supabase/setup/03_health_checks.sql`.

```bash
SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" \
  ./scripts/backup.sh backups
```

## Branding

The logo is `public/logo.jpg`. Replace that file to rebrand. If the image ever fails to load, the app falls back to a text wordmark (`src/components/Logo.tsx`). The colours come from the logo and are defined as CSS variables at the top of `src/styles/app.css`: slate `#2f3e4a`, blue `#3da5e0`, green `#76c442`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Configuration required" screen | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were missing **at build time**. Add them in Vercel and redeploy. |
| "Account not active" after signing in | The login has no active row in `app_users`. Invite the person from *Administration*, or for the first admin run `01_bootstrap_first_admin.sql`. |
| Invitation emails do not arrive | Configure custom SMTP in Supabase Auth (setup step 3.3) and check that the redirect URLs include your domain. |
| "Server functions are not available" locally | `npm run dev` does not serve `/api`. Use `vercel dev`. |
| Reminder emails stay *pending* | Check that `RESEND_API_KEY` and `EMAIL_FROM` are set, that the domain is verified in Resend, and that `02_configure_email_dispatch.sql` was run. Inspect `cron.job_run_details` and `net._http_response`. |
| Reminders were not generated | Check *Administration → Reminders → Last reminder run* and `select * from cron.job`. To run it manually: `select public.generate_due_reminders(true);` |

## Project structure

```
api/                      Vercel serverless functions (server-only secrets)
  _lib/server.ts          service-role client, auth checks, cron secret check
  admin/accounts.ts       list / invite / change role / disable / resend invite
  cron/dispatch.ts        reminder generation + email queue dispatcher
public/                   logo, favicon
scripts/                  backup.sh, restore.sh
src/
  components/             layout, badges, modal/confirm, pickers, states, pagination
  context/                auth session + role, toasts
  lib/                    supabase client, API calls, Colombo date helpers, reports, exporter
  pages/                  dashboard, tasks, task detail/form, employees, profile, reports, notifications, admin
  styles/app.css          design tokens and responsive layout
supabase/
  migrations/             schema, functions/triggers, RLS/views, scheduler (apply in order)
  setup/                  first-admin bootstrap, email dispatch config, health checks
vercel.json               SPA routing, security headers, daily cron
```
