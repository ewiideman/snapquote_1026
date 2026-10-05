// Writes quotes.json for the Production Scheduler on start and every few minutes after, when
// MACK_EXCHANGE_DIR is set. A failure is logged once and shown under Settings, never thrown at a person.
import type { Database } from './db.ts';
import { writeQuotesFile } from '../persistence/exchange.ts';

export interface ExchangeStatus { dir: string; lastWrittenAt: string | null; quotes: number | null; error: string | null }

export interface ExchangeTimer { status: () => ExchangeStatus; writeNow: () => Promise<ExchangeStatus>; stop: () => void }

export const EXCHANGE_EVERY_MINUTES = 10;

export function startExchange(db: Database, dir: string, log: (m: string) => void = console.log): ExchangeTimer {
  const status: ExchangeStatus = { dir, lastWrittenAt: null, quotes: null, error: null };
  let running: Promise<ExchangeStatus> | null = null;
  const writeNow = (): Promise<ExchangeStatus> => {
    running ??= writeQuotesFile(db, dir).then(
      (f) => {
        if (status.error) log('Scheduler exchange: writing quotes.json again.');
        Object.assign(status, { lastWrittenAt: f.writtenAt, quotes: f.quotes.length, error: null });
        return { ...status };
      },
      (err: Error) => {
        if (status.error !== err.message) log(`Scheduler exchange: could not write quotes.json: ${err.message}`);
        status.error = err.message;
        return { ...status };
      },
    ).finally(() => { running = null; });
    return running;
  };
  void writeNow();
  const t = setInterval(() => void writeNow(), EXCHANGE_EVERY_MINUTES * 60_000);
  t.unref();
  return { status: () => ({ ...status }), writeNow, stop: () => clearInterval(t) };
}
