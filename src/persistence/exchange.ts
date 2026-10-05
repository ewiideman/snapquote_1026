// The exchange with the Production Scheduler on disk: writing quotes.json, reading capacity.json,
// and the work-cell-to-facility table Chris Glaski keeps. See src/quoting/exchange.ts.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database, Queryable } from '../server/db.ts';
import type { Account } from './accounts.ts';
import { audit, HttpError } from './util.ts';
import { quoteDetail } from './quotes.ts';
import {
  metalsHours, quotesFile, readCapacityFile, WON_DAYS, workCellCapacity,
  type CalculatorOperation, type CapacityFile, type ExchangeQuote, type QuotesFile, type WorkCellCapacity,
} from '../quoting/exchange.ts';

export const QUOTES_PATH = ['snapquote', 'quotes.json'] as const;
export const CAPACITY_PATH = ['scheduler', 'capacity.json'] as const;

// ---------------------------------------------------------------- work cells and facilities

export interface Mapping { workCell: string; facilities: string[]; setByName: string; setAt: string }

export async function facilityMap(db: Queryable, department = 'metals'): Promise<Map<string, Mapping>> {
  const rows = await db.query<{ work_cell: string; facilities: string[]; set_by_name: string; set_at: string }>(
    `SELECT m.work_cell, m.facilities, u.display_name AS set_by_name, m.set_at FROM pricing.work_cell_facility m JOIN app.user_account u ON u.id = m.set_by WHERE m.department = $1`, [department]);
  return new Map(rows.map((r) => [r.work_cell, { workCell: r.work_cell, facilities: r.facilities, setByName: r.set_by_name, setAt: r.set_at }]));
}

export async function setFacilities(db: Database, actor: Account, workCell: string, facilities: unknown): Promise<void> {
  if (!((actor.role === 'estimator' && actor.department === 'metals') || actor.role === 'manager' || actor.role === 'administrator')) {
    throw new HttpError(403, 'Only Metals estimators, managers and administrators tie work cells to XA facilities.');
  }
  if (facilities !== null && (!Array.isArray(facilities) || !facilities.every((f) => typeof f === 'string' && /^[A-Za-z0-9][A-Za-z0-9/ ._-]{0,30}$/.test(f)))) {
    throw new HttpError(400, 'Facilities are XA facility codes such as 7/V85, or an empty list for a work cell the scheduler does not schedule.');
  }
  const known = await db.query("SELECT 1 FROM pricing.reference WHERE department = 'metals' AND kind = 'work_cell' AND key = $1", [workCell]);
  if (!known.length) throw new HttpError(404, `There is no Metals work cell "${workCell}".`);
  await db.transaction(async (tx) => {
    const before = (await tx.query<{ facilities: string[] }>("SELECT facilities FROM pricing.work_cell_facility WHERE department = 'metals' AND work_cell = $1", [workCell]))[0]?.facilities ?? null;
    if (facilities === null) {
      await tx.query("DELETE FROM pricing.work_cell_facility WHERE department = 'metals' AND work_cell = $1", [workCell]);
    } else {
      await tx.query(
        `INSERT INTO pricing.work_cell_facility (department, work_cell, facilities, set_by) VALUES ('metals', $1, $2, $3)
         ON CONFLICT (department, work_cell) DO UPDATE SET facilities = EXCLUDED.facilities, set_by = EXCLUDED.set_by, set_at = now()`,
        [workCell, [...new Set(facilities as string[])].sort(), actor.id]);
    }
    await audit(tx, actor.id, 'work_cell_facility.set', 'work_cell', workCell, { before, after: facilities });
  });
}

// ---------------------------------------------------------------- quotes.json

/** The quotes the scheduler is told about: with the departments, with the customer, and won lately. */
export async function exchangeQuotes(db: Queryable): Promise<ExchangeQuote[]> {
  const ids = await db.query<{ id: number }>(
    `SELECT id FROM quote.quote WHERE status IN ('estimating', 'sent') OR (status = 'won' AND closed_at > now() - make_interval(days => $1)) ORDER BY number`, [WON_DAYS]);
  const map = await facilityMap(db);
  const out: ExchangeQuote[] = [];
  for (const { id } of ids) {
    const d = await quoteDetail(db, id);
    const q = d.quote;
    const work: ExchangeQuote['work'] = [];
    const withoutHours: ExchangeQuote['withoutHours'] = [];
    for (const l of d.lines) {
      const part = l.partNumber || l.description || `line ${l.position}`;
      if (!l.department) continue;
      const ops = l.estimate?.basis === 'calculator' ? (l.estimate.inputs as { operations?: CalculatorOperation[] })?.operations : undefined;
      if (l.department !== 'metals' || !Array.isArray(ops)) {
        if (l.department !== 'procurement') {
          withoutHours.push({ department: l.department, partNumber: part, reason: !l.estimate ? 'not priced yet' : l.department === 'metals' ? 'priced by hand, not with the calculator' : 'no calculator in SnapQuote for this department yet' });
        }
        continue;
      }
      // A part with its own quantities is not priced at the quote's breaks; its hours follow its own.
      for (const cell of metalsHours(ops, l.pieceQuantities)) {
        work.push({
          department: 'metals', partNumber: part, workCell: cell.workCell, facilities: map.get(cell.workCell)?.facilities ?? null,
          pieces: cell.at.map((a) => a.pieces), hours: cell.at.map((a) => a.hours), ownQuantities: l.quantities.length > 0,
        });
      }
    }
    out.push({
      number: q.number, revision: q.revision, status: q.status as ExchangeQuote['status'], customer: q.customerName, title: q.title, owner: q.ownerName, itar: q.itar,
      customerDueOn: q.customerDueOn, sentAt: q.sentAt, wonAt: q.status === 'won' ? q.closedAt : null, quantities: q.quantities, orderedQuantity: q.orderedQuantity,
      leadTimeWeeks: d.sheet.leadTimeWeeks, work, withoutHours,
    });
  }
  return out;
}

/** Writes the file whole, then renames it into place, so the scheduler never reads half a file. */
export async function writeQuotesFile(db: Queryable, dir: string, now = new Date()): Promise<QuotesFile> {
  const file = quotesFile(now.toISOString(), await exchangeQuotes(db));
  const folder = join(dir, QUOTES_PATH[0]);
  mkdirSync(folder, { recursive: true });
  const target = join(folder, QUOTES_PATH[1]);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(tmp, target);
  return file;
}

// ---------------------------------------------------------------- capacity.json

export type CapacityRead = { connected: false } | { connected: true; file: CapacityFile | null; problem: string | null; readAt: string };

let cached: { path: string; mtimeMs: number; read: CapacityRead } | null = null;

/** The scheduler's capacity file, read again only when it changes. */
export function readCapacity(dir: string | null): CapacityRead {
  if (!dir) return { connected: false };
  const path = join(dir, ...CAPACITY_PATH);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return { connected: true, file: null, problem: 'The scheduler has not written its capacity file yet.', readAt: new Date().toISOString() };
  }
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached.read;
  let read: CapacityRead;
  try {
    const r = readCapacityFile(JSON.parse(readFileSync(path, 'utf8')));
    read = 'file' in r ? { connected: true, file: r.file, problem: null, readAt: new Date().toISOString() } : { connected: true, file: null, problem: r.problem, readAt: new Date().toISOString() };
  } catch {
    read = { connected: true, file: null, problem: 'The capacity file could not be read.', readAt: new Date().toISOString() };
  }
  cached = { path, mtimeMs, read };
  return read;
}

export interface QuoteCapacityRow {
  workCell: string;
  /** Set when the row is one part priced at its own quantities; its hours are at `ownQuantities`, not the quote's. */
  partNumber: string | null;
  ownQuantities: number[] | null;
  facilities: string[] | null;
  /** This quote's hours at each quantity, all its parts together. */
  hours: number[];
  capacity: WorkCellCapacity | null;
}

/** For one quote: each Metals work cell's hours and, when it is tied to facilities, their capacity. */
export async function quoteCapacity(db: Queryable, quoteId: number, dir: string | null): Promise<{ read: CapacityRead; quantities: number[]; rows: QuoteCapacityRow[]; withoutHours: ExchangeQuote['withoutHours'] }> {
  const d = await quoteDetail(db, quoteId);
  const map = await facilityMap(db);
  const byCell = new Map<string, QuoteCapacityRow>();
  const withoutHours: ExchangeQuote['withoutHours'] = [];
  const n = d.quote.quantities.length;
  for (const l of d.lines) {
    if (l.department !== 'metals') continue;
    const ops = l.estimate?.basis === 'calculator' ? (l.estimate.inputs as { operations?: CalculatorOperation[] })?.operations : undefined;
    if (!Array.isArray(ops)) {
      withoutHours.push({ department: 'metals', partNumber: l.partNumber || l.description, reason: l.estimate ? 'priced by hand' : 'not priced yet' });
      continue;
    }
    const own = l.quantities.length > 0;
    for (const cell of metalsHours(ops, l.pieceQuantities)) {
      // Parts at the quote's breaks add up by work cell; a part at its own quantities keeps a row of its own.
      const key = own ? `${cell.workCell}|${l.id}` : cell.workCell;
      const row = byCell.get(key) ?? {
        workCell: cell.workCell, partNumber: own ? l.partNumber || l.description : null, ownQuantities: own ? l.quantities : null,
        facilities: map.get(cell.workCell)?.facilities ?? null, hours: Array.from({ length: own ? cell.at.length : n }, () => 0), capacity: null,
      };
      cell.at.forEach((a, i) => { row.hours[i] = Math.round(((row.hours[i] ?? 0) + a.hours) * 100) / 100; });
      byCell.set(key, row);
    }
  }
  const read = readCapacity(dir);
  const rows = [...byCell.values()].map((r) => ({
    ...r,
    capacity: read.connected && read.file && r.facilities && r.facilities.length ? workCellCapacity(read.file, 'metals', r.facilities) : null,
  }));
  return { read, quantities: d.quote.quantities, rows, withoutHours };
}
