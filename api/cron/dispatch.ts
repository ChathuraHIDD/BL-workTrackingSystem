import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminClient, appUrl, handleError, requireCronSecret, send } from '../_lib/server.js';

/**
 * Scheduled dispatcher.
 *  1. Generates due-date reminders (idempotent; the database does this too via pg_cron).
 *  2. Cancels queued e-mails that no longer apply (task completed, re-dated, unassigned…).
 *  3. Claims pending e-mails with row locks (no double sends across concurrent runs),
 *     sends them via Resend, and records every attempt and failure.
 *
 * Triggered by pg_cron + pg_net every 15 minutes and by Vercel Cron daily as a safety net.
 */
export const config = { maxDuration: 60 };

interface Claimed {
  delivery_id: string;
  recipient_email: string;
  recipient_name: string;
  kind: string;
  title: string;
  body: string;
  task_id: string | null;
  reference_no: string | null;
  attempts: number;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function emailHtml(n: Claimed, link: string | null) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2a33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e6ea">
<tr><td style="background:#2f3e4a;padding:16px 24px;color:#ffffff;font-size:16px;font-weight:600">Battery Lab Energy &middot; Work Tracker</td></tr>
<tr><td style="height:4px;background:linear-gradient(90deg,#3da5e0,#76c442)"></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:14px;color:#5b6873">Hello ${escapeHtml(n.recipient_name)},</p>
<h1 style="margin:0 0 12px;font-size:18px;color:#2f3e4a">${escapeHtml(n.title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escapeHtml(n.body)}</p>
${link ? `<a href="${link}" style="display:inline-block;background:#1a6fa8;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open ${escapeHtml(n.reference_no ?? 'task')}</a>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e2e6ea;font-size:12px;color:#75818b">Automated message from the Battery Lab Energy work tracking system. Times are Asia/Colombo.</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(n: Claimed, link: string | null): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: 'Email provider not configured (RESEND_API_KEY / EMAIL_FROM).' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `delivery-${n.delivery_id}`,
      },
      body: JSON.stringify({
        from,
        to: [n.recipient_email],
        subject: n.title,
        html: emailHtml(n, link),
        text: `${n.title}\n\n${n.body}${link ? `\n\nOpen: ${link}` : ''}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await resp.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!resp.ok) return { ok: false, error: `${resp.status} ${json.name ?? ''} ${json.message ?? ''}`.trim() };
    return { ok: true, id: json.id ?? '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireCronSecret(req);
    const db = adminClient();
    const base = appUrl(req);

    const gen = await db.rpc('generate_due_reminders', { p_force: false });
    if (gen.error) throw new Error(`generate_due_reminders: ${gen.error.message}`);
    const cancelled = await db.rpc('cancel_invalid_deliveries');
    if (cancelled.error) throw new Error(`cancel_invalid_deliveries: ${cancelled.error.message}`);

    const emailConfigured = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
    let sent = 0;
    let failed = 0;

    if (emailConfigured) {
      const started = Date.now();
      // process in batches while time allows
      while (Date.now() - started < 45_000) {
        const { data, error } = await db.rpc('claim_email_deliveries', { p_limit: 25 });
        if (error) throw new Error(`claim_email_deliveries: ${error.message}`);
        const batch = (data ?? []) as Claimed[];
        if (!batch.length) break;
        for (const n of batch) {
          const link = n.task_id ? `${base}/tasks/${n.task_id}` : `${base}/notifications`;
          const r = await sendEmail(n, link);
          const done = await db.rpc('complete_email_delivery', {
            p_delivery_id: n.delivery_id,
            p_success: r.ok,
            p_error: r.ok ? null : r.error,
            p_provider_id: r.ok ? r.id : null,
          });
          if (done.error) console.error('complete_email_delivery failed', done.error);
          if (r.ok) sent++;
          else failed++;
          await new Promise((s) => setTimeout(s, 120)); // stay under provider rate limits
        }
      }
    }

    return send(res, 200, {
      ok: true,
      remindersCreated: gen.data,
      deliveriesCancelled: cancelled.data,
      emailConfigured,
      sent,
      failed,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
