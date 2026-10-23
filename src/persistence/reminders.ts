// Queues the reminders due today: the working day before a department's prices are needed, and before
// the customer's date for a quote not yet sent. Each is queued once (app.notification.about); a quote
// sent to the departments on the reminder day itself is not reminded of, its first email being enough.
import type { Database } from '../server/db.ts';
import { datesRemindedOn, localDate, REMINDER_HOUR } from '../quoting/reminders.ts';
import { notify, quoteFacts, requestPeople } from './notify.ts';

export async function queueReminders(db: Database, now = new Date()): Promise<number> {
  if (now.getHours() < REMINDER_HOUR) return 0;
  const today = localDate(now);
  const dates = datesRemindedOn(today);
  if (!dates.length) return 0;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return db.transaction(async (tx) => {
    let queued = 0;
    // A department still pricing hears its prices are due; one waiting on a question, business development hears instead.
    const requests = await tx.query<{ quote_id: number; department: string; status: string; needed_by: string }>(
      `SELECT r.quote_id, r.department, r.status, to_char(r.needed_by, 'YYYY-MM-DD') AS needed_by
         FROM quote.request r JOIN quote.quote q ON q.id = r.quote_id
        WHERE r.status IN ('open', 'question') AND q.status = 'estimating' AND q.deleted_at IS NULL
          AND to_char(r.needed_by, 'YYYY-MM-DD') = ANY($1::text[]) AND r.sent_at < $2 ORDER BY r.id`, [dates, startOfToday]);
    for (const r of requests) {
      const facts = await quoteFacts(tx, r.quote_id);
      const about = `${r.department}:${r.needed_by}`;
      queued += r.status === 'open'
        ? await notify(tx, await requestPeople(tx, r.quote_id, r.department), null, facts, 'reminder.prices_due', { department: r.department, actorName: 'SnapQuote', neededBy: r.needed_by }, about)
        : await notify(tx, [facts.ownerId], null, facts, 'reminder.question_waiting', { department: r.department, actorName: 'SnapQuote', neededBy: r.needed_by }, about);
    }
    // A quote not sent yet whose customer's date is near reminds its owner.
    const quotes = await tx.query<{ id: number; due: string }>(
      `SELECT id, to_char(customer_due_on, 'YYYY-MM-DD') AS due FROM quote.quote
        WHERE status IN ('draft', 'estimating') AND deleted_at IS NULL AND to_char(customer_due_on, 'YYYY-MM-DD') = ANY($1::text[]) AND created_at < $2 ORDER BY id`, [dates, startOfToday]);
    for (const q of quotes) {
      const facts = await quoteFacts(tx, q.id);
      queued += await notify(tx, [facts.ownerId], null, facts, 'reminder.customer_due', { actorName: 'SnapQuote' }, q.due);
    }
    return queued;
  });
}
