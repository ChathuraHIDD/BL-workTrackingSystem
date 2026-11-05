import { diffDays, formatDateTimeISO, todayISO } from './dates';
import type { Employee, TaskRow } from './types';

export type Row = Record<string, string | number>;

export const TASK_EXPORT_HEADERS = [
  'Reference No',
  'Title',
  'Primary Responsible Employee',
  'Department',
  'Collaborators',
  'Collaborator Departments',
  'Priority',
  'Status',
  'Overdue',
  'Due Date',
  'Completed At (Asia/Colombo)',
  'Timeliness',
  'Created At (Asia/Colombo)',
  'Created By',
  'Last Updated (Asia/Colombo)',
  'Archived',
  'Description',
];

/** One row per task — the canonical task export layout. */
export function taskExportRows(tasks: TaskRow[], today = todayISO()): Row[] {
  return tasks.map((t) => {
    const completedDate = t.completed_at ? formatDateTimeISO(t.completed_at).slice(0, 10) : '';
    let timeliness = '';
    if (t.status === 'Completed' && completedDate) {
      timeliness = completedDate <= t.due_date ? 'On time' : `Late by ${diffDays(completedDate, t.due_date)} day(s)`;
    } else if (t.is_overdue) {
      timeliness = `Overdue by ${diffDays(today, t.due_date)} day(s)`;
    }
    return {
      'Reference No': t.reference_no,
      Title: t.title,
      'Primary Responsible Employee': t.primary_employee_name,
      Department: t.department_name,
      Collaborators: t.collaborators.map((c) => c.name).join('; '),
      'Collaborator Departments': [...new Set(t.collaborators.map((c) => c.department))].join('; '),
      Priority: t.priority,
      Status: t.status,
      Overdue: t.is_overdue ? 'Yes' : 'No',
      'Due Date': t.due_date,
      'Completed At (Asia/Colombo)': formatDateTimeISO(t.completed_at),
      Timeliness: timeliness,
      'Created At (Asia/Colombo)': formatDateTimeISO(t.created_at),
      'Created By': t.created_by_name,
      'Last Updated (Asia/Colombo)': formatDateTimeISO(t.updated_at),
      Archived: t.is_archived ? 'Yes' : 'No',
      Description: t.description,
    };
  });
}

/** One row per (employee, task) involvement, labelled Primary or Collaborator. */
export function assignmentRows(tasks: TaskRow[], inScope?: (employeeId: string) => boolean): Row[] {
  const rows: Row[] = [];
  for (const t of tasks) {
    const people = [
      { id: t.primary_employee_id, name: t.primary_employee_name, department: t.department_name, role: 'Primary' },
      ...t.collaborators.map((c) => ({ id: c.id, name: c.name, department: c.department, role: 'Collaborator' })),
    ];
    for (const p of people) {
      if (inScope && !inScope(p.id)) continue;
      rows.push({
        Employee: p.name,
        'Employee Department': p.department,
        Role: p.role,
        'Reference No': t.reference_no,
        Title: t.title,
        Priority: t.priority,
        Status: t.status,
        Overdue: t.is_overdue ? 'Yes' : 'No',
        'Due Date': t.due_date,
        'Completed At (Asia/Colombo)': formatDateTimeISO(t.completed_at),
      });
    }
  }
  return rows.sort((a, b) =>
    String(a.Employee).localeCompare(String(b.Employee)) || String(a['Due Date']).localeCompare(String(b['Due Date'])),
  );
}

export interface EmployeeWorkload {
  employeeId: string;
  name: string;
  department: string;
  isActive: boolean;
  primaryTotal: number;
  collaboratorTotal: number;
  primaryOpen: number;
  collaboratorOpen: number;
  primaryOverdue: number;
  collaboratorOverdue: number;
  primaryCompleted: number;
  collaboratorCompleted: number;
  completedOnTime: number;
  completedLate: number;
}

export interface CompanyTotals {
  distinctTasks: number;
  open: number;
  inProgress: number;
  onHold: number;
  notStarted: number;
  overdue: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
}

function blank(e: { id: string; name: string; department: string; isActive: boolean }): EmployeeWorkload {
  return {
    employeeId: e.id,
    name: e.name,
    department: e.department,
    isActive: e.isActive,
    primaryTotal: 0,
    collaboratorTotal: 0,
    primaryOpen: 0,
    collaboratorOpen: 0,
    primaryOverdue: 0,
    collaboratorOverdue: 0,
    primaryCompleted: 0,
    collaboratorCompleted: 0,
    completedOnTime: 0,
    completedLate: 0,
  };
}

function onTime(t: TaskRow): boolean {
  return !!t.completed_at && formatDateTimeISO(t.completed_at).slice(0, 10) <= t.due_date;
}

/**
 * Per-employee workload plus company-wide totals.
 * Company totals count each task ONCE (no double counting across primary and
 * collaborators); per-employee rows keep primary and collaborator work separate.
 */
export function buildWorkload(
  tasks: TaskRow[],
  employees: Employee[],
  inScope: (employeeId: string) => boolean = () => true,
): { rows: EmployeeWorkload[]; totals: CompanyTotals } {
  const byId = new Map<string, EmployeeWorkload>();
  const empIndex = new Map(employees.map((e) => [e.id, e]));
  const get = (id: string, name: string, department: string) => {
    let row = byId.get(id);
    if (!row) {
      const e = empIndex.get(id);
      row = blank({ id, name: e?.full_name ?? name, department: e?.department_name ?? department, isActive: e?.is_active ?? true });
      byId.set(id, row);
    }
    return row;
  };

  const totals: CompanyTotals = {
    distinctTasks: 0,
    open: 0,
    inProgress: 0,
    onHold: 0,
    notStarted: 0,
    overdue: 0,
    completed: 0,
    completedOnTime: 0,
    completedLate: 0,
  };
  const counted = new Set<string>();

  for (const t of tasks) {
    const done = t.status === 'Completed';
    const people: { id: string; name: string; department: string; primary: boolean }[] = [
      { id: t.primary_employee_id, name: t.primary_employee_name, department: t.department_name, primary: true },
      ...t.collaborators.map((c) => ({ id: c.id, name: c.name, department: c.department, primary: false })),
    ];
    let involved = false;
    for (const p of people) {
      if (!inScope(p.id)) continue;
      involved = true;
      const r = get(p.id, p.name, p.department);
      if (p.primary) {
        r.primaryTotal++;
        if (done) r.primaryCompleted++;
        else r.primaryOpen++;
        if (t.is_overdue) r.primaryOverdue++;
        if (done) {
          if (onTime(t)) r.completedOnTime++;
          else r.completedLate++;
        }
      } else {
        r.collaboratorTotal++;
        if (done) r.collaboratorCompleted++;
        else r.collaboratorOpen++;
        if (t.is_overdue) r.collaboratorOverdue++;
      }
    }
    if (involved && !counted.has(t.id)) {
      counted.add(t.id);
      totals.distinctTasks++;
      if (done) {
        totals.completed++;
        if (onTime(t)) totals.completedOnTime++;
        else totals.completedLate++;
      } else {
        totals.open++;
        if (t.status === 'In Progress') totals.inProgress++;
        if (t.status === 'On Hold') totals.onHold++;
        if (t.status === 'Not Started') totals.notStarted++;
      }
      if (t.is_overdue) totals.overdue++;
    }
  }

  // employees in scope with no work still appear (zero rows are informative)
  for (const e of employees) {
    if (e.is_active && inScope(e.id) && !byId.has(e.id)) {
      byId.set(e.id, blank({ id: e.id, name: e.full_name, department: e.department_name, isActive: e.is_active }));
    }
  }

  const rows = [...byId.values()].sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
  return { rows, totals };
}

export function workloadExportRows(rows: EmployeeWorkload[]): Row[] {
  return rows.map((r) => ({
    Employee: r.name,
    Department: r.department,
    'Employee Status': r.isActive ? 'Active' : 'Inactive',
    'Primary Assignments': r.primaryTotal,
    'Collaborative Assignments': r.collaboratorTotal,
    'Total Involvement': r.primaryTotal + r.collaboratorTotal,
    'Open (Primary)': r.primaryOpen,
    'Open (Collaborator)': r.collaboratorOpen,
    'Overdue (Primary)': r.primaryOverdue,
    'Overdue (Collaborator)': r.collaboratorOverdue,
    'Completed (Primary)': r.primaryCompleted,
    'Completed (Collaborator)': r.collaboratorCompleted,
    'Primary Completed On Time': r.completedOnTime,
    'Primary Completed Late': r.completedLate,
  }));
}

export function totalsExportRows(t: CompanyTotals): Row[] {
  return [
    { Metric: 'Distinct tasks (each task counted once)', Value: t.distinctTasks },
    { Metric: 'Open tasks', Value: t.open },
    { Metric: '  Not Started', Value: t.notStarted },
    { Metric: '  In Progress', Value: t.inProgress },
    { Metric: '  On Hold', Value: t.onHold },
    { Metric: 'Overdue tasks', Value: t.overdue },
    { Metric: 'Completed tasks', Value: t.completed },
    { Metric: '  Completed on or before due date', Value: t.completedOnTime },
    { Metric: '  Completed after due date', Value: t.completedLate },
  ];
}
