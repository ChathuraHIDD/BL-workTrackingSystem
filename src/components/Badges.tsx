import { AlertCircle, Archive, Crown, Users } from 'lucide-react';
import type { Priority, Status } from '../lib/types';

const statusClass: Record<Status, string> = {
  'Not Started': 'st-notstarted',
  'In Progress': 'st-progress',
  'On Hold': 'st-hold',
  Completed: 'st-done',
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${statusClass[status]}`}>{status}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge pr-${priority.toLowerCase()}`}>
      <span className="pr-dot" aria-hidden />
      {priority}
    </span>
  );
}

export function OverdueBadge() {
  return (
    <span className="badge st-overdue">
      <AlertCircle size={13} aria-hidden /> Overdue
    </span>
  );
}

export function ArchivedBadge() {
  return (
    <span className="badge st-archived">
      <Archive size={13} aria-hidden /> Archived
    </span>
  );
}

export function RoleTag({ role }: { role: 'primary' | 'collaborator' }) {
  return role === 'primary' ? (
    <span className="role-tag role-primary" title="Primary responsible employee">
      <Crown size={12} aria-hidden /> Primary
    </span>
  ) : (
    <span className="role-tag role-collab" title="Collaborator">
      <Users size={12} aria-hidden /> Collaborator
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <span className={`badge ${active ? 'st-done' : 'st-archived'}`}>{active ? 'Active' : 'Inactive'}</span>;
}
