// What SnapQuote and the Production Scheduler tell each other, through files in a folder on Mack's
// server (MACK_EXCHANGE_DIR; Eric Wiideman, Oct 5, 2026). Pure: building and reading the files.
//
//   snapquote/quotes.json     written here, read by the scheduler: open and won quotes, with the hours
//                             each work cell would spend on them: Metals work cells, Molding (ADC)
//                             presses, Machining machines and Assembly labor, from each calculator.
//   scheduler/capacity.json   written by the scheduler, read here: each XA facility's hours a week,
//                             late work, the next six weeks and the week it is caught up.
//
// The two name machines differently: SnapQuote by its rate sheets ("Trumpf V85 CNC Press Brake", a press
// "Cav-30 [2300 (268)]", a machine "A20"), the scheduler by XA facility ("7/V85"). Each department ties
// one to the other on the Work cells page (Chris Glaski for Metals); nothing is matched by name. A work
// cell not tied yet is reported as such, never guessed.

export const QUOTES_FORMAT = 'mack.snapquote.quotes';
export const CAPACITY_FORMAT = 'mack.scheduler.capacity';
export const EXCHANGE_VERSION = 1;
/** Won quotes stay in the file this long after they are won: SnapQuote cannot see when the order reaches XA. */
export const WON_DAYS = 90;

// ---------------------------------------------------------------- hours from a Metals estimate

export interface CalculatorOperation { workCell?: unknown; setupHours?: unknown; runMinutesPerPiece?: unknown }

export interface WorkCellHours {
  workCell: string;
  /** One entry per quantity of the quote, in the same order. */
  at: { pieces: number; setupHours: number; runHours: number; hours: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Standard hours per work cell for one Metals part: one setup per lot plus run minutes × pieces, as
 * XA routing hours are counted. Efficiency is the scheduler's to apply, not this file's.
 */
export function metalsHours(operations: readonly CalculatorOperation[], pieceQuantities: readonly number[]): WorkCellHours[] {
  const byCell = new Map<string, WorkCellHours>();
  for (const op of operations) {
    const cell = typeof op.workCell === 'string' ? op.workCell.trim() : '';
    const setup = Number(op.setupHours ?? 0);
    const run = Number(op.runMinutesPerPiece ?? 0);
    if (!cell || !Number.isFinite(setup) || !Number.isFinite(run) || setup < 0 || run < 0) continue;
    const entry = byCell.get(cell) ?? { workCell: cell, at: pieceQuantities.map((pieces) => ({ pieces, setupHours: 0, runHours: 0, hours: 0 })) };
    entry.at = entry.at.map((a) => {
      const setupHours = a.setupHours + setup;
      const runHours = a.runHours + (run * a.pieces) / 60;
      return { pieces: a.pieces, setupHours: r2(setupHours), runHours: r2(runHours), hours: r2(setupHours + runHours) };
    });
    byCell.set(cell, entry);
  }
  return [...byCell.values()];
}

/** The departments whose calculators give hours; Procurement buys, so its parts have none. */
export const HOURS_DEPARTMENTS = ['metals', 'molding', 'machining', 'assembly'] as const;
export type HoursDepartment = (typeof HOURS_DEPARTMENTS)[number];
/** Assembly's labor is one work cell: the calculator has no stations, only steps. */
export const ASSEMBLY_WORK_CELL = 'Assembly';

export interface SavedEstimate { basis: string; inputs?: unknown; detail?: unknown }

/**
 * A part's standard hours per work cell from the calculator that priced it, or why there are none.
 * `setupIncluded` is false where the calculator gives no setup time (Molding: setup is in dollars).
 * - Metals: each operation's setup once a lot, plus run minutes × pieces.
 * - Molding (ADC): pieces ÷ parts an hour on the press the price was worked out on (scrap already in it).
 * - Machining: each machine's setup once a lot, plus cycle seconds × pieces.
 * - Assembly: the steps' assembly, test and QA seconds an assembly × pieces, not rounded as the price is.
 */
export function calculatorHours(department: string, estimate: SavedEstimate | null, pieceQuantities: readonly number[]): { cells: WorkCellHours[]; setupIncluded: boolean } | { reason: string } {
  if (!estimate) return { reason: 'not priced yet' };
  if (estimate.basis !== 'calculator') return { reason: estimate.basis === 'vendor_quote' ? 'priced from a vendor quote' : 'priced by hand, not with the calculator' };
  const inputs = (estimate.inputs ?? {}) as Record<string, unknown>;
  const detail = (estimate.detail ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const lot = (cell: string, setup: number, runHoursEach: number): WorkCellHours => ({
    workCell: cell,
    at: pieceQuantities.map((pieces) => { const runHours = r2(runHoursEach * pieces); return { pieces, setupHours: r2(setup), runHours, hours: r2(setup + runHoursEach * pieces) }; }),
  });
  if (department === 'metals') {
    const ops = inputs['operations'];
    return Array.isArray(ops) ? { cells: metalsHours(ops as CalculatorOperation[], pieceQuantities), setupIncluded: true } : { reason: 'the calculator saved no operations' };
  }
  if (department === 'molding') {
    const press = (detail['press'] as { id?: unknown } | undefined)?.id;
    const perHour = num((detail['process'] as { partsPerHour?: unknown } | undefined)?.partsPerHour);
    if (typeof press !== 'string' || !(perHour > 0)) return { reason: 'the calculator saved no press or parts an hour' };
    return { cells: [lot(press, 0, 1 / perHour)], setupIncluded: false };
  }
  if (department === 'machining') {
    const cells: WorkCellHours[] = [];
    const add = (machine: unknown, setup: unknown, cycleSec: unknown) => {
      if (typeof machine !== 'string' || !machine.trim()) return;
      const prior = cells.find((c) => c.workCell === machine.trim());
      const next = lot(machine.trim(), num(setup), num(cycleSec) / 3600);
      if (!prior) { cells.push(next); return; }
      prior.at = prior.at.map((a, i) => { const b = next.at[i] as WorkCellHours['at'][number]; return { pieces: a.pieces, setupHours: r2(a.setupHours + b.setupHours), runHours: r2(a.runHours + b.runHours), hours: r2(a.hours + b.hours) }; });
    };
    add(inputs['primaryMachine'], inputs['primarySetupHours'], inputs['primaryCycleSec']);
    add(inputs['secondaryMachine'], inputs['secondarySetupHours'], inputs['secondaryCycleSec']);
    return cells.length ? { cells, setupIncluded: true } : { reason: 'the calculator saved no machine' };
  }
  if (department === 'assembly') {
    const seconds = num(detail['assemblySec']) + num(detail['testSec']) + num(detail['qaSec']);
    return seconds > 0 ? { cells: [lot(ASSEMBLY_WORK_CELL, 0, seconds / 3600)], setupIncluded: true } : { reason: 'the calculator saved no step times' };
  }
  return { reason: 'bought, not made at Mack' };
}

// ---------------------------------------------------------------- quotes.json

export type ExchangeStatus = 'estimating' | 'sent' | 'won';

export interface ExchangeQuote {
  number: string;
  revision: number;
  status: ExchangeStatus;
  customer: string | null;
  title: string;
  owner: string;
  itar: boolean;
  /** The customer's date for the quote itself, not for delivery. */
  customerDueOn: string | null;
  sentAt: string | null;
  wonAt: string | null;
  /** Assembly quantities quoted, smallest first. */
  quantities: number[];
  /** The quantity the customer ordered, when business development recorded it on winning. */
  orderedQuantity: number | null;
  /** The longest lead time any department gave, in weeks. */
  leadTimeWeeks: number | null;
  work: {
    department: HoursDepartment;
    partNumber: string;
    workCell: string;
    /** XA facility codes as the scheduler names them; [] when Chris said the work cell is not a scheduled facility; null when not tied yet. */
    facilities: string[] | null;
    /** Pieces of the part at each entry of `hours`. */
    pieces: number[];
    /** Standard hours: at each of the quote's `quantities` in order, unless `ownQuantities`, when at the part's own quantities (`pieces`). */
    hours: number[];
    /** The customer asked for this part at quantities of its own, not at the quote's assembly breaks. */
    ownQuantities: boolean;
    /** False when the calculator gives no setup time, so `hours` are run hours only (Molding). */
    setupIncluded: boolean;
  }[];
  /** Parts whose hours SnapQuote cannot give: not priced yet, or priced by hand. Procurement's are never listed. */
  withoutHours: { department: string; partNumber: string; reason: string }[];
}

export interface QuotesFile {
  format: typeof QUOTES_FORMAT;
  version: typeof EXCHANGE_VERSION;
  writtenAt: string;
  wonDays: number;
  quotes: ExchangeQuote[];
}

export function quotesFile(writtenAt: string, quotes: ExchangeQuote[]): QuotesFile {
  return { format: QUOTES_FORMAT, version: EXCHANGE_VERSION, writtenAt, wonDays: WON_DAYS, quotes };
}

// ---------------------------------------------------------------- capacity.json

export interface FacilityCapacity {
  code: string;
  name: string;
  /** Standard hours per clock hour on the facility (0.85 in Metals). The scheduler's hours are clock hours. */
  efficiency: number;
  hoursPerWeek: number;
  lateHours: number;
  /** Hours due in the next six weeks. */
  nextSixWeeksHours: number;
  /** (late + next six weeks) ÷ six weeks of capacity; null with no capacity. */
  load: number | null;
  /** The week (1 = this week) by which the late work and everything due by then is done; 0 nothing late; null not within the horizon. */
  caughtUpWeek: number | null;
}

export interface CapacityDepartment { key: string; label: string; asOf: string; scheduleName: string; facilities: FacilityCapacity[] }

export interface CapacityFile {
  format: typeof CAPACITY_FORMAT;
  version: typeof EXCHANGE_VERSION;
  writtenAt: string;
  /** How far ahead caughtUpWeek looks, in weeks. */
  horizonWeeks: number;
  basis: string;
  departments: CapacityDepartment[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The scheduler's file, checked; a file this version cannot read says why instead of being half-read. */
export function readCapacityFile(raw: unknown): { file: CapacityFile } | { problem: string } {
  const f = raw as Partial<CapacityFile> | null;
  if (!f || typeof f !== 'object' || f.format !== CAPACITY_FORMAT) return { problem: 'The file is not the scheduler\'s capacity file.' };
  if (f.version !== EXCHANGE_VERSION) return { problem: `The scheduler wrote version ${String(f.version)} of the capacity file; this SnapQuote reads version ${EXCHANGE_VERSION}.` };
  if (typeof f.writtenAt !== 'string' || !Array.isArray(f.departments) || !isNum(f.horizonWeeks)) return { problem: 'The capacity file is incomplete.' };
  for (const d of f.departments) {
    if (typeof d?.key !== 'string' || !Array.isArray(d.facilities)) return { problem: 'The capacity file is incomplete.' };
    for (const x of d.facilities) {
      if (typeof x?.code !== 'string' || !isNum(x.efficiency) || x.efficiency <= 0 || !isNum(x.hoursPerWeek) || !isNum(x.lateHours) || !isNum(x.nextSixWeeksHours)) return { problem: `Facility ${String(x?.code)} in the capacity file is incomplete.` };
    }
  }
  return { file: f as CapacityFile };
}

export interface WorkCellCapacity {
  facilities: FacilityCapacity[];
  /** The facilities' efficiency, averaged: a quote's standard hours ÷ this are hours of the work cell's clock. */
  efficiency: number;
  /** Facility codes tied to the work cell that the scheduler does not report. */
  unknown: string[];
  hoursPerWeek: number;
  lateHours: number;
  nextSixWeeksHours: number;
  load: number | null;
  /** The latest of the facilities' weeks; null if any of them is not caught up within the horizon. */
  caughtUpWeek: number | null;
}

/** A work cell's capacity: its facilities added together. */
export function workCellCapacity(file: CapacityFile, department: string, codes: readonly string[]): WorkCellCapacity {
  const all = file.departments.filter((d) => d.key === department).flatMap((d) => d.facilities);
  const facilities = codes.map((c) => all.find((f) => f.code === c)).filter((f): f is FacilityCapacity => !!f);
  const unknown = codes.filter((c) => !all.some((f) => f.code === c));
  const hoursPerWeek = r2(facilities.reduce((s, f) => s + f.hoursPerWeek, 0));
  const lateHours = r2(facilities.reduce((s, f) => s + f.lateHours, 0));
  const nextSixWeeksHours = r2(facilities.reduce((s, f) => s + f.nextSixWeeksHours, 0));
  const weeks = facilities.map((f) => f.caughtUpWeek);
  const efficiency = facilities.length ? facilities.reduce((s, f) => s + f.efficiency, 0) / facilities.length : 1;
  return {
    facilities, unknown, efficiency: Math.round(efficiency * 1000) / 1000, hoursPerWeek, lateHours, nextSixWeeksHours,
    load: hoursPerWeek > 0 ? r2((lateHours + nextSixWeeksHours) / (hoursPerWeek * 6)) : null,
    caughtUpWeek: facilities.length === 0 || weeks.some((w) => w === null) ? null : Math.max(...(weeks as number[])),
  };
}
