// Looks every 10 minutes for reminders due today and queues them; the mail timer sends them. Runs
// whether or not SMTP_HOST is set, so reminders wait with the other emails until mail is turned on.
import type { Database } from './db.ts';
import { queueReminders } from '../persistence/reminders.ts';

export function startReminders(db: Database, log: (m: string) => void = console.log): { stop: () => void } {
  let lastError: string | null = null;
  const pass = async () => {
    try {
      await queueReminders(db);
      lastError = null;
    } catch (err) {
      if (lastError !== (err as Error).message) log(`Reminders: ${(err as Error).message}`);
      lastError = (err as Error).message;
    }
  };
  const t = setInterval(() => void pass(), 10 * 60_000);
  t.unref();
  void pass();
  return { stop: () => clearInterval(t) };
}
