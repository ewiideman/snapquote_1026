// What a quote is worth, line by line and quantity by quantity. Pure: no database, no I/O.
//
// A quote's quantities are assembly breaks. A line priced at those breaks uses break × quantity per
// assembly as its own quantity in pieces; a line with quantities of its own (separate parts on one
// RFQ) uses those. A department prices a line per piece at each of the line's quantities; business
// development may set its own price at any of them, with a reason. Nothing is filled in: a quantity
// with no price stays missing, and a quote with a missing price cannot be sent.
import type { DepartmentKey } from './departments.ts';

export type QuoteStatus = 'draft' | 'estimating' | 'sent' | 'won' | 'lost' | 'no_bid';
export type RequestStatus = 'open' | 'question' | 'answered' | 'withdrawn';
/** Where a quote stands, as the board shows it. `ready`: every department has answered. */
export type Stage = 'draft' | 'estimating' | 'ready' | 'sent' | 'won' | 'lost' | 'no_bid';

export interface RequestLike {
  department: DepartmentKey;
  status: RequestStatus;
}

export function stageOf(status: QuoteStatus, requests: readonly RequestLike[]): Stage {
  if (status !== 'estimating') return status;
  const live = requests.filter((r) => r.status !== 'withdrawn');
  return live.length > 0 && live.every((r) => r.status === 'answered') ? 'ready' : 'estimating';
}

/** The departments a quote is still waiting on, and those waiting on business development. */
export function waitingOn(requests: readonly RequestLike[]): { departments: DepartmentKey[]; questions: DepartmentKey[] } {
  return {
    departments: requests.filter((r) => r.status === 'open').map((r) => r.department),
    questions: requests.filter((r) => r.status === 'question').map((r) => r.department),
  };
}

/** Quantities are compared and keyed to the cent of a piece, the precision the database keeps. */
export const qtyKey = (q: number): string => (Math.round(q * 100) / 100).toFixed(2);
const roundQty = (q: number): number => Math.round(q * 100) / 100;

export interface LineLike {
  id: number;
  qtyPer: number;
  quantities: readonly number[];
}

/** The line's quantities in pieces. */
export function lineQuantities(quoteQuantities: readonly number[], line: LineLike): number[] {
  return line.quantities.length > 0 ? [...line.quantities] : quoteQuantities.map((q) => roundQty(q * line.qtyPer));
}

/** True when every line is priced at the quote's assembly breaks, so a price per assembly means something. */
export const isAssembly = (lines: readonly LineLike[]): boolean => lines.length > 0 && lines.every((l) => l.quantities.length === 0);

export interface PricedLine extends LineLike {
  department: DepartmentKey | null;
  /** The department's unit prices by quantity (qtyKey), when it has priced the line. */
  estimate: { prices: ReadonlyMap<string, number>; oneTimeCost: number; oneTimeLabel: string; leadTimeWeeks: number | null } | null;
  /** Business development's prices by quantity (qtyKey). */
  overrides: ReadonlyMap<string, { unitPrice: number; reason: string }>;
}

export interface SheetCell {
  quantity: number;
  /** The department's price, or null. */
  estimated: number | null;
  /** Business development's price, or null. */
  override: number | null;
  overrideReason: string | null;
  /** What the customer is quoted: the override if set, else the estimate, else null (missing). */
  unitPrice: number | null;
  extended: number | null;
}

export interface SheetLine {
  lineId: number;
  cells: SheetCell[];
  oneTimeCost: number;
  oneTimeLabel: string;
  leadTimeWeeks: number | null;
}

export interface AssemblyBreak {
  quantity: number;
  /** Price of one assembly: the sum of each line's unit price × quantity per; null if any is missing. */
  unitPrice: number | null;
  extended: number | null;
}

export interface Sheet {
  lines: SheetLine[];
  /** Present when the quote is one assembly priced at the quote's breaks. */
  assembly: AssemblyBreak[] | null;
  oneTimeTotal: number;
  /** The longest lead time any department gave, in weeks. */
  leadTimeWeeks: number | null;
  /** Every line priced at every one of its quantities. */
  complete: boolean;
  /** Quantities still without a price, as "line id → quantities". */
  missing: { lineId: number; quantities: number[] }[];
}

const money = (n: number): number => Math.round(n * 10000) / 10000;

export function buildSheet(quoteQuantities: readonly number[], lines: readonly PricedLine[]): Sheet {
  const sheetLines: SheetLine[] = lines.map((line) => {
    const cells = lineQuantities(quoteQuantities, line).map((quantity): SheetCell => {
      const key = qtyKey(quantity);
      const estimated = line.estimate?.prices.get(key) ?? null;
      const ov = line.overrides.get(key) ?? null;
      const unitPrice = ov ? ov.unitPrice : estimated;
      return { quantity, estimated, override: ov?.unitPrice ?? null, overrideReason: ov?.reason ?? null, unitPrice, extended: unitPrice === null ? null : money(unitPrice * quantity) };
    });
    return { lineId: line.id, cells, oneTimeCost: line.estimate?.oneTimeCost ?? 0, oneTimeLabel: line.estimate?.oneTimeLabel ?? '', leadTimeWeeks: line.estimate?.leadTimeWeeks ?? null };
  });
  const missing = sheetLines
    .map((l) => ({ lineId: l.lineId, quantities: l.cells.filter((c) => c.unitPrice === null).map((c) => c.quantity) }))
    .filter((m) => m.quantities.length > 0);
  const assembly = isAssembly(lines) && quoteQuantities.length > 0
    ? quoteQuantities.map((quantity, i): AssemblyBreak => {
      let unit: number | null = 0;
      lines.forEach((line, j) => {
        const cell = sheetLines[j]?.cells[i];
        unit = unit === null || !cell || cell.unitPrice === null ? null : unit + cell.unitPrice * line.qtyPer;
      });
      const u = unit as number | null;
      return { quantity, unitPrice: u === null ? null : money(u), extended: u === null ? null : money(u * quantity) };
    })
    : null;
  const leads = sheetLines.map((l) => l.leadTimeWeeks).filter((w): w is number => w !== null);
  return {
    lines: sheetLines,
    assembly,
    oneTimeTotal: money(sheetLines.reduce((s, l) => s + l.oneTimeCost, 0)),
    leadTimeWeeks: leads.length ? Math.max(...leads) : null,
    complete: lines.length > 0 && missing.length === 0,
    missing,
  };
}

// ---------------------------------------------------------------- what stops a step

export interface DraftCheck {
  customer: boolean;
  quantities: readonly number[];
  lines: readonly { id: number; partNumber: string; description: string; department: DepartmentKey | null; quantities: readonly number[] }[];
}

/** Why a draft cannot go to the departments yet, in words for the person sending it. Empty: it can. */
export function sendToEstimatingProblems(q: DraftCheck): string[] {
  const out: string[] = [];
  if (!q.customer) out.push('Name the customer.');
  if (q.lines.length === 0) out.push('Add at least one part.');
  const unnamed = q.lines.filter((l) => !l.partNumber.trim() && !l.description.trim()).length;
  if (unnamed) out.push(`${unnamed === 1 ? 'One part has' : `${unnamed} parts have`} no part number or description.`);
  const noDept = q.lines.filter((l) => !l.department).length;
  if (noDept) out.push(`Choose who prices ${noDept === 1 ? 'one part' : `${noDept} parts`}.`);
  if (q.quantities.length === 0 && q.lines.some((l) => l.quantities.length === 0)) out.push('Enter at least one quantity.');
  return out;
}

/** Proposed quantity breaks from free text: "100, 500, 1k" → [100, 500, 1000]. Sorted, no repeats. */
export function parseQuantities(text: string): { quantities: number[]; problem: string | null } {
  const parts = text.split(/[\s,;/]+/).map((p) => p.trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)(k|m)?$/i.exec(p.replace(/,/g, ''));
    if (!m) return { quantities: [], problem: `"${p}" is not a quantity.` };
    const n = Number(m[1]) * (m[2]?.toLowerCase() === 'k' ? 1000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1);
    if (!(n > 0)) return { quantities: [], problem: 'Quantities must be more than zero.' };
    out.push(roundQty(n));
  }
  return { quantities: [...new Set(out)].sort((a, b) => a - b), problem: null };
}
