/** Turn Supabase / Postgres errors into messages people can act on. */
export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.';
  const e = err as { message?: string; code?: string; details?: string };
  const msg = e.message ?? String(err);
  switch (e.code) {
    case '23505':
      if (msg.includes('employees_email')) return 'An employee with this email address already exists.';
      if (msg.includes('departments_name')) return 'A department with this name already exists.';
      return 'This record already exists.';
    case '23503':
      return 'This record is linked to other records and cannot be changed that way.';
    case '23514':
      return 'Some values are not valid. Please check the form and try again.';
    case '42501':
      return msg.startsWith('permission denied') ? 'You do not have permission to do that.' : msg;
    case 'PGRST301':
    case 'PGRST303':
      return 'Your session has expired. Please sign in again.';
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network error — check your connection and try again.';
  return msg;
}
