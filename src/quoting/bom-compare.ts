// A parts list dropped on a quote that already has parts: what it adds, what it no longer has, and what
// it changes, so business development can bring the quote's parts up to the customer's newer list --
// or keep them, because a second spreadsheet is not always a replacement (an approved-vendor list, one
// subassembly's parts). Pure.
//
// A part is matched by part number, ignoring case and spacing; the same revision first, then any, so a
// new revision of a part is that part changed, not a new one. A part with no number is matched by its
// description. Changes looked at: revision, quantity per assembly, description.

export interface PartRow { partNumber: string; revision: string; description: string; qtyPer: number; notes?: string }
export interface QuotePart extends PartRow { id: number }
export type Change = 'revision' | 'quantity' | 'description';

export interface PartsComparison {
  added: PartRow[];
  removed: QuotePart[];
  changed: { line: QuotePart; to: PartRow; what: Change[] }[];
  /** Parts in both, unchanged. */
  same: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const pnOf = (p: PartRow) => norm(p.partNumber);

export function compareParts(onQuote: readonly QuotePart[], incoming: readonly PartRow[]): PartsComparison {
  const free = new Set(onQuote.map((l) => l.id));
  const take = (pred: (l: QuotePart) => boolean): QuotePart | null => {
    const l = onQuote.find((x) => free.has(x.id) && pred(x));
    if (l) free.delete(l.id);
    return l ?? null;
  };
  const pairs: [PartRow, QuotePart | null][] = incoming.map((p) => [p, null]);
  // The same number and revision first, so two revisions of one part on both pair up as they are.
  for (const pair of pairs) {
    const p = pair[0];
    if (pnOf(p)) pair[1] = take((l) => pnOf(l) === pnOf(p) && norm(l.revision) === norm(p.revision));
  }
  for (const pair of pairs) {
    const p = pair[0];
    if (pair[1]) continue;
    pair[1] = pnOf(p) ? take((l) => pnOf(l) === pnOf(p)) : take((l) => !pnOf(l) && norm(l.description) === norm(p.description) && !!norm(p.description));
  }
  const out: PartsComparison = { added: [], removed: [], changed: [], same: 0 };
  for (const [p, l] of pairs) {
    if (!l) { out.added.push(p); continue; }
    const what: Change[] = [];
    if (norm(l.revision) !== norm(p.revision)) what.push('revision');
    if (Number(l.qtyPer) !== Number(p.qtyPer)) what.push('quantity');
    if (norm(l.description) !== norm(p.description) && !!norm(p.description)) what.push('description');
    if (what.length) out.changed.push({ line: l, to: p, what });
    else out.same++;
  }
  out.removed = onQuote.filter((l) => free.has(l.id));
  return out;
}

/**
 * The list is a newer copy of the quote's parts worth reviewing: it shares parts with the quote, and
 * would remove or change one. A list that only adds parts changes nothing on the quote, so its new
 * parts are simply added.
 */
export const worthReviewing = (c: PartsComparison): boolean =>
  c.same + c.changed.length > 0 && c.removed.length + c.changed.length > 0;
