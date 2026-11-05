export type Role = 'admin' | 'manager' | 'employee';
export type Priority = 'High' | 'Medium' | 'Low';
export type Status = 'Not Started' | 'In Progress' | 'On Hold' | 'Completed';

export const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
export const STATUSES: Status[] = ['Not Started', 'In Progress', 'On Hold', 'Completed'];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  employee: 'Employee',
};

export interface Department {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Employee {
  id: string;
  full_name: string;
  department_id: number;
  department_name: string;
  job_title: string | null;
  email: string;
  is_active: boolean;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollaboratorInfo {
  id: string;
  name: string;
  department: string;
  is_active: boolean;
}

export interface TaskRow {
  id: string;
  reference_no: string;
  title: string;
  description: string;
  primary_employee_id: string;
  primary_employee_name: string;
  primary_employee_email: string;
  primary_employee_active: boolean;
  department_id: number;
  department_name: string;
  collaborator_ids: string[];
  collaborator_names: string[];
  collaborator_names_text: string;
  collaborators: CollaboratorInfo[];
  due_date: string;
  priority: Priority;
  priority_rank: number;
  status: Status;
  is_overdue: boolean;
  completed_at: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  kind: 'comment' | 'progress';
  body: string;
  author_name: string;
  author_employee_id: string | null;
  created_at: string;
}

export interface TaskActivity {
  id: number;
  task_id: string;
  reference_no?: string;
  task_title?: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_name: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  task_id: string | null;
  kind: 'assigned' | 'collaborator_added' | 'due_date_changed' | 'due_reminder';
  title: string;
  body: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface AppSettings {
  reminder_time: string;
  reminder_days_before: number[];
  email_notifications_enabled: boolean;
  last_reminder_run_at: string | null;
  updated_at: string;
}

export interface DashboardSummary {
  today: string;
  week_start: string;
  week_end: string;
  total_active: number;
  in_progress: number;
  on_hold: number;
  not_started: number;
  due_this_week: number;
  overdue: number;
  completed_in_period: number;
  by_department: { department: string; open_count: number; overdue_count: number }[];
  by_employee: {
    id: string;
    name: string;
    department: string;
    primary_count: number;
    collaborator_count: number;
    overdue_count: number;
  }[];
}
