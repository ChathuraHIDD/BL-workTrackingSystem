import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Employee } from '../lib/types';

/** Single select, grouped by department. Inactive employees only appear if already selected. */
export function EmployeeSelect({
  id,
  employees,
  value,
  onChange,
  placeholder = 'Select employee',
  includeInactive = false,
  required,
  invalid,
  describedBy,
}: {
  id: string;
  employees: Employee[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  includeInactive?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, Employee[]>();
    for (const e of employees) {
      if (!includeInactive && !e.is_active && e.id !== value) continue;
      const list = m.get(e.department_name) ?? [];
      list.push(e);
      m.set(e.department_name, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [employees, includeInactive, value]);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      <option value="">{placeholder}</option>
      {groups.map(([dept, list]) => (
        <optgroup key={dept} label={dept}>
          {list.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
              {e.is_active ? '' : ' (inactive)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Searchable checkbox list for collaborators. */
export function EmployeeMultiSelect({
  employees,
  value,
  onChange,
  excludeId,
  labelledBy,
}: {
  employees: Employee[];
  value: string[];
  onChange: (v: string[]) => void;
  excludeId?: string;
  labelledBy: string;
}) {
  const [q, setQ] = useState('');
  const selected = new Set(value);
  const options = employees.filter(
    (e) =>
      e.id !== excludeId &&
      (e.is_active || selected.has(e.id)) &&
      (!q || `${e.full_name} ${e.department_name}`.toLowerCase().includes(q.toLowerCase())),
  );
  const byId = new Map(employees.map((e) => [e.id, e]));
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="multi-select" role="group" aria-labelledby={labelledBy}>
      {value.length > 0 && (
        <div className="chip-row">
          {value.map((id) => (
            <span key={id} className="chip chip-active">
              {byId.get(id)?.full_name ?? 'Unknown'}
              <button type="button" className="chip-x" onClick={() => toggle(id)} aria-label={`Remove ${byId.get(id)?.full_name ?? 'collaborator'}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="search-input">
        <Search size={15} aria-hidden />
        <input type="search" placeholder="Search employees…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search collaborators" />
      </div>
      <ul className="multi-options">
        {options.length === 0 && <li className="muted pad-sm">No matching employees</li>}
        {options.map((e) => (
          <li key={e.id}>
            <label>
              <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
              <span>{e.full_name}</span>
              <span className="muted small">{e.department_name}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
