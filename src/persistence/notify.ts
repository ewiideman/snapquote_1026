// Email about quotes. Events are written to app.notification inside the change that causes them;
// sendQueued sends them through Mack's mail relay. Nobody is emailed about their own action.
import type { Queryable } from '../server/db.ts';
import { departmentName } from '../quoting/departments.ts';

export type NotificationKind =
  | 'request.new' | 'request.reopened' | 'question.asked' | 'question.answered'
  | 'prices.back' | 'quote.ready' | 'price.changed' | 'quote.deleted';

interface QuoteFacts { id: number; number: string; revision: number; customer: string | null; title: string; ownerId: string; ownerName: string; customerDueOn: string | null }

export async function quoteFacts(db: Queryable, quoteId: number): Promise<QuoteFacts> {
  const r = (await db.query<{ id: number; number: string; revision: number; customer: string | null; title: string; owner_id: string; owner_name: string; customer_due_on: string | null }>(
    `SELECT q.id, q.number, q.revision, c.name AS customer, q.title, q.owner_id, u.display_name AS owner_name, q.customer_due_on
       FROM quote.quote q LEFT JOIN quote.customer c ON c.id = q.customer_id JOIN app.user_account u ON u.id = q.owner_id WHERE q.id = $1`, [quoteId]))[0];
  if (!r) throw new Error(`No quote ${quoteId}`);
  return { id: r.id, number: r.number, revision: r.revision, customer: r.customer, title: r.title, ownerId: r.owner_id, ownerName: r.owner_name, customerDueOn: r.customer_due_on };
}

/** The estimators of a department who can sign in. */
export async function estimatorsOf(db: Queryable, department: string): Promise<string[]> {
  return (await db.query<{ id: string }>("SELECT id FROM app.user_account WHERE role = 'estimator' AND department = $1 AND disabled_at IS NULL AND password_hash IS NOT NULL", [department])).map((r) => r.id);
}

const label = (q: QuoteFacts) => `${q.number}${q.revision ? ` rev ${q.revision}` : ''} ${q.customer ?? 'No customer'}${q.title ? ` — ${q.title}` : ''}`;
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);

/** The words of each kind of email, from what happened. */
export function compose(kind: NotificationKind, q: QuoteFacts, x: { department?: string; actorName: string; neededBy?: string | null; text?: string }): { subject: string; body: string } {
  const dept = x.department ? departmentName(x.department) : '';
  switch (kind) {
    case 'request.new':
      return { subject: `New quote to price: ${label(q)}`, body: `${x.actorName} sent ${q.number} to ${dept}.${x.neededBy ? ` Prices are needed by ${day(x.neededBy)}.` : ''}` };
    case 'request.reopened':
      return { subject: `${q.number} changed — please check ${dept}'s prices`, body: `${x.actorName} changed the parts on ${label(q)} after ${dept} had priced it.` };
    case 'question.asked':
      return { subject: `${dept} has a question on ${q.number}`, body: `${x.actorName} (${dept}) asked:\n\n${x.text ?? ''}\n\nYour reply in the quote's conversation hands it back to them.` };
    case 'question.answered':
      return { subject: `Answer on ${q.number}: ${q.customer ?? ''}`.trim(), body: `${x.actorName} answered:\n\n${x.text ?? ''}\n\nThe quote is back in ${dept}'s queue.` };
    case 'prices.back':
      return { subject: `${dept} priced ${q.number} ${q.customer ?? ''}`.trim(), body: `${x.actorName} sent ${dept}'s prices for ${label(q)}. Still waiting on other departments.` };
    case 'quote.ready':
      return { subject: `Ready to send: ${label(q)}`, body: `Every department has priced ${q.number}${dept ? ` (${dept} was last)` : ''}. Review the prices and send the customer their copy.${q.customerDueOn ? ` ${q.customer ?? 'The customer'} wants it by ${day(q.customerDueOn)}.` : ''}` };
    case 'quote.deleted':
      return { subject: `${q.number} withdrawn: no prices needed from ${dept}`, body: `${x.actorName} deleted ${label(q)}${x.text ? `: ${x.text}` : ''}. It is off ${dept}'s queue; nothing more is needed.` };
    case 'price.changed':
      return { subject: `${dept} changed a price on ${q.number}`, body: `${x.actorName} changed a ${dept} price on ${label(q)} after answering. Check the review page before sending.` };
  }
}

/** Queues one email per person, never to the person who did it. */
export async function notify(db: Queryable, to: readonly string[], actorId: string, q: QuoteFacts, kind: NotificationKind, x: Parameters<typeof compose>[2]): Promise<void> {
  const { subject, body } = compose(kind, q, x);
  for (const user of new Set(to)) {
    if (user === actorId) continue;
    await db.query('INSERT INTO app.notification (to_user, quote_id, kind, subject, body) VALUES ($1, $2, $3, $4, $5)', [user, q.id, kind, subject, body]);
  }
}

export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }

/** Sends what is queued. A person without an email address, or with email turned off, is skipped. */
export async function sendQueued(db: Queryable, mailer: Mailer, appUrl: string | null, limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  const rows = await db.query<{ id: number; quote_id: number | null; subject: string; body: string; attempts: number; email: string | null; email_notifications: boolean; disabled_at: string | null; display_name: string }>(
    `SELECT n.id, n.quote_id, n.subject, n.body, n.attempts, u.email, u.email_notifications, u.disabled_at, u.display_name
       FROM app.notification n JOIN app.user_account u ON u.id = n.to_user WHERE n.status = 'queued' ORDER BY n.id LIMIT $1`, [limit]);
  const out = { sent: 0, skipped: 0, failed: 0 };
  for (const r of rows) {
    if (!r.email || !r.email_notifications || r.disabled_at) {
      await db.query("UPDATE app.notification SET status = 'skipped', done_at = now(), error = $2 WHERE id = $1", [r.id, !r.email ? 'no email address' : r.disabled_at ? 'account disabled' : 'email turned off']);
      out.skipped++;
      continue;
    }
    const link = appUrl && r.quote_id ? `\n\nOpen it: ${appUrl.replace(/\/$/, '')}/#/quotes/${r.quote_id}` : '\n\nOpen SnapQuote to see it.';
    try {
      await mailer.send(r.email, r.subject, `${r.body}${link}\n\n— SnapQuote. You can turn these emails off under your name in SnapQuote.`);
      await db.query("UPDATE app.notification SET status = 'sent', attempts = attempts + 1, done_at = now(), error = NULL WHERE id = $1", [r.id]);
      out.sent++;
    } catch (err) {
      const failed = r.attempts + 1 >= 3;
      await db.query(`UPDATE app.notification SET attempts = attempts + 1, error = $2${failed ? ", status = 'failed', done_at = now()" : ''} WHERE id = $1`, [r.id, (err as Error).message.slice(0, 500)]);
      if (failed) out.failed++;
    }
  }
  return out;
}
