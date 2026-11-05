import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminClient, appUrl, handleError, HttpError, requireAdmin, send } from '../_lib/server.js';

const ROLES = ['admin', 'manager', 'employee'] as const;
type Role = (typeof ROLES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v: unknown, name: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, `Invalid ${name}.`);
  return v;
}
function assertRole(v: unknown): Role {
  if (!ROLES.includes(v as Role)) throw new HttpError(400, 'Invalid role.');
  return v as Role;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const db = adminClient();
    const caller = await requireAdmin(req, db);

    if (req.method === 'GET') {
      const { data: rows, error } = await db
        .from('app_users')
        .select('user_id, role, is_active, employee_id, created_at, employees(full_name)')
        .order('created_at');
      if (error) throw new HttpError(500, error.message);

      // auth details (email, last sign-in, invitation state)
      const authUsers = new Map<string, { email?: string; last_sign_in_at?: string | null; invited_at?: string | null; email_confirmed_at?: string | null }>();
      for (let page = 1; page < 50; page++) {
        const { data, error: e } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        if (e) throw new HttpError(500, e.message);
        for (const u of data.users) authUsers.set(u.id, u);
        if (data.users.length < 1000) break;
      }

      const accounts = (rows ?? []).map((r) => {
        const u = authUsers.get(r.user_id);
        const emp = r.employees as unknown as { full_name: string } | null;
        return {
          user_id: r.user_id,
          email: u?.email ?? '(deleted user)',
          role: r.role,
          is_active: r.is_active,
          employee_id: r.employee_id,
          employee_name: emp?.full_name ?? null,
          last_sign_in_at: u?.last_sign_in_at ?? null,
          invited_at: u?.invited_at ?? null,
          confirmed: !!u?.email_confirmed_at,
          created_at: r.created_at,
        };
      });
      return send(res, 200, { accounts });
    }

    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};

    switch (body.action) {
      case 'invite': {
        const employeeId = assertUuid(body.employee_id, 'employee');
        const role = assertRole(body.role);
        const { data: emp, error } = await db.from('employees').select('id, email, full_name, is_active').eq('id', employeeId).maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!emp) throw new HttpError(404, 'Employee not found.');
        if (!emp.is_active) throw new HttpError(400, 'Cannot invite an inactive employee.');
        const { data: linked } = await db.from('app_users').select('user_id').eq('employee_id', employeeId).maybeSingle();
        if (linked) throw new HttpError(409, 'This employee already has a login account.');

        const { data: invited, error: invErr } = await db.auth.admin.inviteUserByEmail(String(emp.email), {
          redirectTo: `${appUrl(req)}/`,
          data: { full_name: emp.full_name },
        });
        if (invErr || !invited.user) {
          const msg = invErr?.message ?? 'Invitation failed.';
          throw new HttpError(/already been registered|already exists/i.test(msg) ? 409 : 400,
            /already been registered|already exists/i.test(msg)
              ? 'A login with this email already exists. Link it from the Supabase dashboard or use a different email.'
              : msg);
        }
        const { error: insErr } = await db.from('app_users').insert({ user_id: invited.user.id, employee_id: employeeId, role, is_active: true });
        if (insErr) {
          await db.auth.admin.deleteUser(invited.user.id); // keep auth and accounts consistent
          throw new HttpError(500, insErr.message);
        }
        return send(res, 200, { ok: true, message: `Invitation sent to ${emp.email}.` });
      }

      case 'update': {
        const userId = assertUuid(body.user_id, 'user');
        if (userId === caller.id) throw new HttpError(400, 'You cannot change your own role or status.');
        const patch: { role?: Role; is_active?: boolean } = {};
        if (body.role !== undefined) patch.role = assertRole(body.role);
        if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
        if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update.');
        const { error } = await db.from('app_users').update(patch).eq('user_id', userId);
        if (error) throw new HttpError(400, error.message);
        if (patch.is_active !== undefined) {
          const { error: banErr } = await db.auth.admin.updateUserById(userId, {
            ban_duration: patch.is_active ? 'none' : '876000h',
          });
          if (banErr) throw new HttpError(500, banErr.message);
        }
        return send(res, 200, {
          ok: true,
          message: patch.is_active === false ? 'Account disabled.' : patch.is_active ? 'Account enabled.' : 'Role updated.',
        });
      }

      case 'resend': {
        const userId = assertUuid(body.user_id, 'user');
        const { data, error } = await db.auth.admin.getUserById(userId);
        if (error || !data.user?.email) throw new HttpError(404, 'User not found.');
        const redirectTo = `${appUrl(req)}/`;
        if (!data.user.email_confirmed_at) {
          const { error: e } = await db.auth.admin.inviteUserByEmail(data.user.email, { redirectTo });
          if (e) throw new HttpError(400, e.message);
          return send(res, 200, { ok: true, message: `Invitation re-sent to ${data.user.email}.` });
        }
        const { error: e } = await db.auth.resetPasswordForEmail(data.user.email, { redirectTo });
        if (e) throw new HttpError(400, e.message);
        return send(res, 200, { ok: true, message: `Password reset email sent to ${data.user.email}.` });
      }

      default:
        throw new HttpError(400, 'Unknown action.');
    }
  } catch (err) {
    return handleError(res, err);
  }
}
