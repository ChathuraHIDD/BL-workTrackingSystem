import { formatDate } from './dates';
import type { TaskActivity } from './types';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (v: string | null) => (v && isoDate.test(v) ? formatDate(v) : (v ?? '—'));

/** Human-readable sentence fragment for an audit entry (actor name is shown separately). */
export function describeActivity(a: TaskActivity): string {
  switch (a.action) {
    case 'created':
      return 'created';
    case 'edited':
      return a.field === 'description' ? 'edited the description of' : `renamed "${a.old_value}" → "${a.new_value}" on`;
    case 'priority_changed':
      return `changed priority ${a.old_value} → ${a.new_value} on`;
    case 'due_date_changed':
      return `moved the due date ${fmt(a.old_value)} → ${fmt(a.new_value)} on`;
    case 'status_changed':
      return `changed status ${a.old_value} → ${a.new_value} on`;
    case 'completed':
      return 'completed';
    case 'reopened':
      return `reopened (${a.new_value})`;
    case 'reassigned':
      return `reassigned primary from ${a.old_value} to ${a.new_value} on`;
    case 'collaborator_added':
      return `added collaborator ${a.new_value} to`;
    case 'collaborator_removed':
      return `removed collaborator ${a.old_value} from`;
    case 'archived':
      return 'archived';
    case 'restored':
      return 'restored';
    default:
      return `${a.action.replace(/_/g, ' ')} on`;
  }
}

/** Full sentence for the task history view (no task reference needed). */
export function describeActivityLong(a: TaskActivity): string {
  switch (a.action) {
    case 'created':
      return `Created the task — ${a.new_value ?? ''}`;
    case 'edited':
      return a.field === 'description' ? 'Edited the description' : `Changed title from "${a.old_value}" to "${a.new_value}"`;
    case 'priority_changed':
      return `Changed priority from ${a.old_value} to ${a.new_value}`;
    case 'due_date_changed':
      return `Changed due date from ${fmt(a.old_value)} to ${fmt(a.new_value)}`;
    case 'status_changed':
      return `Changed status from ${a.old_value} to ${a.new_value}`;
    case 'completed':
      return `Marked as Completed (was ${a.old_value})`;
    case 'reopened':
      return `Reopened — status set to ${a.new_value}`;
    case 'reassigned':
      return `Reassigned primary responsibility from ${a.old_value} to ${a.new_value}`;
    case 'collaborator_added':
      return `Added ${a.new_value} as collaborator`;
    case 'collaborator_removed':
      return `Removed ${a.old_value} as collaborator`;
    case 'archived':
      return 'Archived the task';
    case 'restored':
      return 'Restored the task from the archive';
    default:
      return a.action;
  }
}
