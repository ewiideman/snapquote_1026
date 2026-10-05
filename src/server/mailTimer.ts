// Sends queued quote emails through Mack's mail relay every 30 seconds, when SMTP_HOST is set.
// Without it nothing is sent and the emails stay queued, so turning mail on later sends what is waiting.
import nodemailer from 'nodemailer';
import type { Database } from './db.ts';
import type { AppConfig } from './config.ts';
import { sendQueued, type Mailer } from '../persistence/notify.ts';

export function makeMailer(cfg: NonNullable<AppConfig['mail']>): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.password ?? '' } } : {}),
  });
  return { send: async (to, subject, text) => { await transport.sendMail({ from: cfg.from, to, subject, text }); } };
}

export function startMail(db: Database, mailer: Mailer, appUrl: string | null, log: (m: string) => void = console.log): { stop: () => void } {
  let running = false;
  let lastError: string | null = null;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const r = await sendQueued(db, mailer, appUrl);
      if (r.failed) log(`Quote email: ${r.failed} could not be sent after three tries (see app.notification).`);
      lastError = null;
    } catch (err) {
      if (lastError !== (err as Error).message) log(`Quote email: ${(err as Error).message}`);
      lastError = (err as Error).message;
    } finally {
      running = false;
    }
  };
  const t = setInterval(() => void pass(), 30_000);
  t.unref();
  void pass();
  return { stop: () => clearInterval(t) };
}
