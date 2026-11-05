import { supabase } from './supabase';
import { endExclusiveTs, startOfDayTs } from './dates';
import type {
  AppSettings,
  DashboardSummary,
  Department,
  Employee,
  NotificationRow,
  Priority,
  Role,
  Status,
  TaskActivity,
  TaskComment,
  TaskRow,
} from './types';

function check<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

// ---------------------------------------------------------------------------
// Task filters (shared by the task list, profile pages and report exports)
// ---------------------------------------------------------------------------
export type DateField = 'due' | 'completed' | 'created';
export type StatusFilter = Status | 'open' | '';
export type ArchivedFilter = 'exclude' | 'include' | 'only';

export interface TaskFilters {
  q?: string;
  employeeId?: string;
  employeeRole?: 'any' | 'primary' | 'collaborator';
  departmentId?: number | '';
  priority?: Priority | '';
  status?: StatusFilter;
  overdue?: boolean;
  dateField?: DateField;
  from?: string;
  to?: string;
  archived?: ArchivedFilter;
}

export type SortKey =
  | 'reference_no'
  | 'title'
  | 'primary_employee_name'
  | 'department_name'
  | 'priority_rank'
  | 'status'
  | 'due_date'
  | 'completed_at'
  | 'updated_at';

/** PostgREST filter strings must not contain its reserved characters. */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTaskFilters<Q extends { or: any; eq: any; neq: any; gte: any; lt: any; lte: any; ilike: any }>(
  query: Q,
  f: TaskFilters,
): Q {
  let q = query;
  const term = f.q ? sanitizeSearch(f.q) : '';
  if (term) {
    const p = `*${term}*`;
    q = q.or(
      [
        `title.ilike.${p}`,
        `reference_no.ilike.${p}`,
        `description.ilike.${p}`,
        `primary_employee_name.ilike.${p}`,
        `collaborator_names_text.ilike.${p}`,
      ].join(','),
    );
  }
  if (f.employeeId && UUID_RE.test(f.employeeId)) {
    const role = f.employeeRole ?? 'any';
    if (role === 'primary') q = q.eq('primary_employee_id', f.employeeId);
    else if (role === 'collaborator') q = q.or(`collaborator_ids.cs.{${f.employeeId}}`);
    else q = q.or(`primary_employee_id.eq.${f.employeeId},collaborator_ids.cs.{${f.employeeId}}`);
  }
  if (f.departmentId) q = q.eq('department_id', f.departmentId);
  if (f.priority) q = q.eq('priority', f.priority);
  if (f.status === 'open') q = q.neq('status', 'Completed');
  else if (f.status) q = q.eq('status', f.status);
  if (f.overdue) q = q.eq('is_overdue', true);

  const field = f.dateField ?? 'due';
  if (field === 'due') {
    if (f.from) q = q.gte('due_date', f.from);
    if (f.to) q = q.lte('due_date', f.to);
  } else {
    const col = field === 'completed' ? 'completed_at' : 'created_at';
    if (f.from) q = q.gte(col, startOfDayTs(f.from));
    if (f.to) q = q.lt(col, endExclusiveTs(f.to));
  }

  const archived = f.archived ?? 'exclude';
  if (archived === 'exclude') q = q.eq('is_archived', false);
  else if (archived === 'only') q = q.eq('is_archived', true);
  return q;
}

export async function listTasks(
  f: TaskFilters,
  opts: { sort: SortKey; asc: boolean; page: number; pageSize: number },
): Promise<{ rows: TaskRow[]; total: number }> {
  const fromIdx = (opts.page - 1) * opts.pageSize;
  let q = supabase.from('task_overview').select('*', { count: 'exact' });
  q = applyTaskFilters(q, f);
  q = q.order(opts.sort, { ascending: opts.asc, nullsFirst: false });
  if (opts.sort !== 'reference_no') q = q.order('reference_no', { ascending: true });
  const res = await q.range(fromIdx, fromIdx + opts.pageSize - 1);
  if (res.error) throw res.error;
  return { rows: (res.data ?? []) as TaskRow[], total: res.count ?? 0 };
}

/** Fetch every matching task (paged under the hood) — used for exports and profiles. */
export async function fetchAllTasks(f: TaskFilters, sort: SortKey = 'due_date'): Promise<TaskRow[]> {
  const PAGE = 1000;
  const out: TaskRow[] = [];
  for (let page = 0; page < 200; page++) {
    let q = supabase.from('task_overview').select('*');
    q = applyTaskFilters(q, f);
    const res = await q
      .order(sort, { ascending: true, nullsFirst: false })
      .order('reference_no', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (res.error) throw res.error;
    const rows = (res.data ?? []) as TaskRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const res = await supabase.from('task_overview').select('*').eq('id', id).maybeSingle();
  return check(res) as TaskRow | null;
}

export interface TaskInput {
  title: string;
  description: string;
  primary_employee_id: string;
  collaborator_ids: string[];
  due_date: string;
  priority: Priority;
  status: Status;
}

export async function saveTask(id: string | null, input: TaskInput): Promise<string> {
  const res = await supabase.rpc('save_task', {
    p_id: id,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_primary_employee_id: input.primary_employee_id,
    p_collaborator_ids: input.collaborator_ids,
    p_due_date: input.due_date,
    p_priority: input.priority,
    p_status: input.status,
  });
  return check(res) as string;
}

export async function setTaskStatus(id: string, status: Status, note?: string): Promise<void> {
  const res = await supabase.rpc('set_task_status', {
    p_task_id: id,
    p_status: status,
    p_note: note?.trim() || null,
  });
  if (res.error) throw res.error;
}

export async function archiveTask(id: string, archive: boolean): Promise<void> {
  const res = await supabase.rpc('archive_task', { p_task_id: id, p_archive: archive });
  if (res.error) throw res.error;
}

export async function listComments(taskId: string): Promise<TaskComment[]> {
  const res = await supabase
    .from('task_comments')
    .select('id, task_id, kind, body, author_name, author_employee_id, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  return check(res) as TaskComment[];
}

export async function addComment(taskId: string, body: string, kind: 'comment' | 'progress'): Promise<void> {
  const res = await supabase.rpc('add_task_comment', { p_task_id: taskId, p_body: body.trim(), p_kind: kind });
  if (res.error) throw res.error;
}

export async function listActivity(taskId: string): Promise<TaskActivity[]> {
  const res = await supabase
    .from('task_activity')
    .select('id, task_id, action, field, old_value, new_value, actor_name, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  return check(res) as TaskActivity[];
}

export async function recentActivity(limit = 12): Promise<TaskActivity[]> {
  const res = await supabase
    .from('activity_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  return check(res) as TaskActivity[];
}

export async function dashboardSummary(from: string, to: string): Promise<DashboardSummary> {
  const res = await supabase.rpc('dashboard_summary', { p_from: from, p_to: to });
  return check(res) as DashboardSummary;
}

// ---------------------------------------------------------------------------
// Employees & departments
// ---------------------------------------------------------------------------
export async function listDepartments(): Promise<Department[]> {
  const res = await supabase.from('departments').select('id, name, sort_order, is_active').order('sort_order').order('name');
  return check(res) as Department[];
}

export async function saveDepartment(d: { id?: number; name: string; sort_order: number; is_active: boolean }) {
  const payload = { name: d.name.trim(), sort_order: d.sort_order, is_active: d.is_active };
  const res = d.id
    ? await supabase.from('departments').update(payload).eq('id', d.id)
    : await supabase.from('departments').insert(payload);
  if (res.error) throw res.error;
}

export async function listEmployees(): Promise<Employee[]> {
  const res = await supabase.from('employee_directory').select('*').order('full_name');
  return check(res) as Employee[];
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const res = await supabase.from('employee_directory').select('*').eq('id', id).maybeSingle();
  return check(res) as Employee | null;
}

export interface EmployeeInput {
  full_name: string;
  department_id: number;
  job_title: string;
  email: string;
  is_active: boolean;
}

export async function saveEmployee(id: string | null, input: EmployeeInput): Promise<string> {
  const payload = {
    full_name: input.full_name.trim(),
    department_id: input.department_id,
    job_title: input.job_title.trim() || null,
    email: input.email.trim().toLowerCase(),
    is_active: input.is_active,
  };
  if (id) {
    const res = await supabase.from('employees').update(payload).eq('id', id).select('id').single();
    return (check(res) as { id: string }).id;
  }
  const res = await supabase.from('employees').insert(payload).select('id').single();
  return (check(res) as { id: string }).id;
}

export async function setEmployeeActive(id: string, active: boolean): Promise<void> {
  const res = await supabase.from('employees').update({ is_active: active }).eq('id', id);
  if (res.error) throw res.error;
}

export async function countOpenTasksFor(employeeId: string): Promise<number> {
  const res = await supabase
    .from('task_overview')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'Completed')
    .eq('is_archived', false)
    .or(`primary_employee_id.eq.${employeeId},collaborator_ids.cs.{${employeeId}}`);
  if (res.error) throw res.error;
  return res.count ?? 0;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export async function listNotifications(employeeId: string, unreadOnly: boolean, limit = 100): Promise<NotificationRow[]> {
  let q = supabase
    .from('notifications')
    .select('id, task_id, kind, title, body, is_read, read_at, created_at')
    .eq('recipient_employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.eq('is_read', false);
  return check(await q) as NotificationRow[];
}

export async function unreadCount(employeeId: string): Promise<number> {
  const res = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_employee_id', employeeId)
    .eq('is_read', false);
  if (res.error) throw res.error;
  return res.count ?? 0;
}

export async function markNotificationsRead(ids: string[] | null): Promise<void> {
  const res = await supabase.rpc('mark_notifications_read', { p_ids: ids });
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// Settings & administration
// ---------------------------------------------------------------------------
export async function getSettings(): Promise<AppSettings> {
  const res = await supabase
    .from('app_settings')
    .select('reminder_time, reminder_days_before, email_notifications_enabled, last_reminder_run_at, updated_at')
    .single();
  return check(res) as AppSettings;
}

export async function updateSettings(s: Pick<AppSettings, 'reminder_time' | 'reminder_days_before' | 'email_notifications_enabled'>) {
  const { data: u } = await supabase.auth.getUser();
  const res = await supabase
    .from('app_settings')
    .update({ ...s, updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null })
    .eq('id', true);
  if (res.error) throw res.error;
}

export interface DeliveryLogRow {
  id: string;
  recipient_email: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  notifications: { title: string; kind: string } | null;
}

export async function listDeliveries(status: string, limit = 100): Promise<DeliveryLogRow[]> {
  let q = supabase
    .from('notification_deliveries')
    .select('id, recipient_email, status, attempts, last_error, sent_at, created_at, notifications(title, kind)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  return check(await q) as unknown as DeliveryLogRow[];
}

/** Calls a privileged server function with the signed-in user's access token. */
async function callServer<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  let resp: Response;
  try {
    resp = await fetch(path, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const text = await resp.text();
  let json: { error?: string } & Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      resp.status === 404
        ? 'Server functions are not available. Run the app with "vercel dev" or deploy it to Vercel.'
        : `Unexpected server response (${resp.status}).`,
    );
  }
  if (!resp.ok) throw new Error(json.error || `Request failed (${resp.status}).`);
  return json as T;
}

export interface AccountRow {
  user_id: string;
  email: string;
  role: Role;
  is_active: boolean;
  employee_id: string | null;
  employee_name: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
  confirmed: boolean;
  created_at: string;
}

export function listAccounts(): Promise<{ accounts: AccountRow[] }> {
  return callServer('/api/admin/accounts', { method: 'GET' });
}

export function accountAction(body:
  | { action: 'invite'; employee_id: string; role: Role }
  | { action: 'update'; user_id: string; role?: Role; is_active?: boolean }
  | { action: 'resend'; user_id: string }): Promise<{ ok: true; message?: string }> {
  return callServer('/api/admin/accounts', { method: 'POST', body });
}
