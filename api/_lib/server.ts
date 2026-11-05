import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

/** Server-only Supabase client using the service role key. Never import from /src. */
export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, 'Server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function send(res: VercelResponse, status: number, body: unknown) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export function handleError(res: VercelResponse, err: unknown) {
  if (err instanceof HttpError) return send(res, err.status, { error: err.message });
  console.error(err);
  return send(res, 500, { error: 'Unexpected server error.' });
}

function bearer(req: VercelRequest): string | null {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Verify the caller's Supabase session and require an active administrator. */
export async function requireAdmin(req: VercelRequest, db: SupabaseClient) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Not signed in.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  const { data: acct, error: e2 } = await db
    .from('app_users')
    .select('role, is_active')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (e2) throw new HttpError(500, 'Could not verify permissions.');
  if (!acct || !acct.is_active || acct.role !== 'admin') throw new HttpError(403, 'Administrator access required.');
  return data.user;
}

/** Cron endpoints: Vercel Cron and pg_cron both send "Authorization: Bearer <CRON_SECRET>". */
export function requireCronSecret(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(500, 'CRON_SECRET is not configured.');
  const token = bearer(req);
  if (!token || !safeEqual(token, secret)) throw new HttpError(401, 'Unauthorized.');
}

export function appUrl(req: VercelRequest): string {
  const configured = process.env.APP_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `https://${host}`;
}
