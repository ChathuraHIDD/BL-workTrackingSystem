import { describe, expect, it } from 'vitest';
import { assignmentRows, buildWorkload, taskExportRows } from '../reports';
import type { Employee, TaskRow } from '../types';

const emp = (id: string, name: string, dept: string, deptId = 1): Employee => ({
  id,
  full_name: name,
  department_id: deptId,
  department_name: dept,
  job_title: null,
  email: `${id}@x.com`,
  is_active: true,
  deactivated_at: null,
  created_at: '',
  updated_at: '',
});
const A = emp('a', 'Amal', 'Sales', 1);
const B = emp('b', 'Bimal', 'Finance', 2);
const C = emp('c', 'Chamari', 'Sales', 1);

function task(id: string, primary: Employee, collabs: Employee[], over: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    reference_no: `BLE-2026-0000${id}`,
    title: `Task ${id}`,
    description: '',
    primary_employee_id: primary.id,
    primary_employee_name: primary.full_name,
    primary_employee_email: primary.email,
    primary_employee_active: true,
    department_id: primary.department_id,
    department_name: primary.department_name,
    collaborator_ids: collabs.map((c) => c.id),
    collaborator_names: collabs.map((c) => c.full_name),
    collaborator_names_text: collabs.map((c) => c.full_name).join(', '),
    collaborators: collabs.map((c) => ({ id: c.id, name: c.full_name, department: c.department_name, is_active: true })),
    due_date: '2026-11-07',
    priority: 'Medium',
    priority_rank: 2,
    status: 'In Progress',
    is_overdue: false,
    completed_at: null,
    is_archived: false,
    archived_at: null,
    created_at: '2026-11-01T04:00:00Z',
    created_by: null,
    created_by_name: 'Admin',
    updated_at: '2026-11-01T04:00:00Z',
    ...over,
  };
}

describe('workload summary', () => {
  const tasks = [
    task('1', A, [B, C]),
    task('2', B, [A], { status: 'Completed', completed_at: '2026-11-06T10:00:00Z' }), // on time
    task('3', A, [], { is_overdue: true, due_date: '2026-11-01' }),
    task('4', C, [], { status: 'Completed', completed_at: '2026-11-08T20:00:00Z', due_date: '2026-11-08' }), // 9 Nov Colombo → late
  ];

  it('counts each task once in company totals', () => {
    const { totals } = buildWorkload(tasks, [A, B, C]);
    expect(totals.distinctTasks).toBe(4);
    expect(totals.open).toBe(2);
    expect(totals.completed).toBe(2);
    expect(totals.overdue).toBe(1);
    expect(totals.completedOnTime).toBe(1);
    expect(totals.completedLate).toBe(1);
  });

  it('separates primary and collaborative work per employee', () => {
    const { rows } = buildWorkload(tasks, [A, B, C]);
    const a = rows.find((r) => r.employeeId === 'a')!;
    expect(a.primaryTotal).toBe(2);
    expect(a.collaboratorTotal).toBe(1);
    expect(a.primaryOverdue).toBe(1);
    expect(a.collaboratorCompleted).toBe(1);
    const sumInvolvement = rows.reduce((s, r) => s + r.primaryTotal + r.collaboratorTotal, 0);
    expect(sumInvolvement).toBe(7); // 3+2+1+1 involvements > 4 distinct tasks, by design
  });

  it('department scope only counts in-scope employees and their tasks', () => {
    const sales = (id: string) => [A, C].some((e) => e.id === id);
    const { rows, totals } = buildWorkload(tasks, [A, B, C], sales);
    expect(rows.map((r) => r.employeeId).sort()).toEqual(['a', 'c']);
    expect(totals.distinctTasks).toBe(4); // task 2 involves A as collaborator
    const { totals: t2 } = buildWorkload(tasks, [A, B, C], (id) => id === 'c');
    expect(t2.distinctTasks).toBe(2);
  });

  it('export rows label roles and timeliness', () => {
    const rows = assignmentRows([tasks[0]]);
    expect(rows.map((r) => `${r.Employee}:${r.Role}`)).toEqual(['Amal:Primary', 'Bimal:Collaborator', 'Chamari:Collaborator']);
    const exp = taskExportRows(tasks, '2026-11-05');
    expect(exp[1].Timeliness).toBe('On time');
    expect(exp[2].Timeliness).toBe('Overdue by 4 day(s)');
    expect(exp[3].Timeliness).toBe('Late by 1 day(s)');
    expect(exp[3]['Completed At (Asia/Colombo)']).toBe('2026-11-09 01:30');
  });
});
