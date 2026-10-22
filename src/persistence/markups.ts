// The departments' markups, in one place for an administrator: each calculator's percent figures, with
// Mack's figure from the old SnapQuote beside the one in use. Stored in each calculator's own settings
// row (pricing.reference <department>/setting/calculation); a change sets one figure and keeps the rest.
import type { Database, Queryable } from '../server/db.ts';
import type { Account } from './accounts.ts';
import { HttpError } from './util.ts';
import { referenceRows, setReference } from './reference.ts';
import { METALS_DEFAULTS } from '../pricing/metals/index.ts';
import { MOLDING_DEFAULTS } from '../pricing/molding/index.ts';
import { MACHINING_DEFAULTS } from '../pricing/machining/index.ts';

/** `multiplier`: stored as 1.2 for 20%; `fraction`: stored as 0.2 for 20%. */
/** `max`: the highest percent the calculator reads back as given (Metals reads a fraction over 1 as a percent). */
interface MarkupField { key: string; label: string; hint: string; stored: 'multiplier' | 'fraction'; imported: number; max: number }
interface MarkupGroup { department: 'metals' | 'molding' | 'machining'; name: string; fields: MarkupField[] }

const GROUPS: MarkupGroup[] = [
  { department: 'metals', name: 'Metals', fields: [
    { key: 'materialMarkup', label: 'Sheet material and hardware', hint: 'On the purchased sheet and hardware cost', stored: 'multiplier', imported: METALS_DEFAULTS.materialMarkup, max: 900 },
    { key: 'ospMarkupPct', label: 'Outside processing', hint: "On Procurement's price for plating, paint and the like", stored: 'fraction', imported: METALS_DEFAULTS.ospMarkupPct, max: 100 },
    { key: 'ospFreightPct', label: 'Outside processing freight', hint: 'Added after the markup', stored: 'fraction', imported: METALS_DEFAULTS.ospFreightPct, max: 100 },
  ] },
  { department: 'molding', name: 'Molding (ADC)', fields: [
    { key: 'materialAdder', label: 'Material adder', hint: 'On resin; the old form did not say what it is for', stored: 'fraction', imported: MOLDING_DEFAULTS.materialAdder, max: 1000 },
    { key: 'materialScrap', label: 'Material scrap', hint: 'Resin cost ÷ (1 − this)', stored: 'fraction', imported: MOLDING_DEFAULTS.materialScrap, max: 99 },
    { key: 'moldingScrap', label: 'Press-time scrap', hint: 'Parts an hour × (1 − this)', stored: 'fraction', imported: MOLDING_DEFAULTS.moldingScrap, max: 99 },
  ] },
  { department: 'machining', name: 'Machining', fields: [
    { key: 'rawMaterialMarkup', label: 'Raw material', hint: 'On bar stock', stored: 'fraction', imported: MACHINING_DEFAULTS.rawMaterialMarkup, max: 1000 },
    { key: 'outsideOperationMarkup', label: 'Outside operations', hint: 'On outside processing', stored: 'fraction', imported: MACHINING_DEFAULTS.outsideOperationMarkup, max: 1000 },
    { key: 'outsideOperationShippingRate', label: 'Outside operations shipping', hint: '', stored: 'fraction', imported: MACHINING_DEFAULTS.outsideOperationShippingRate, max: 1000 },
    { key: 'assemblyMarkup', label: 'Assembly', hint: 'On assembly priced inside a machined part', stored: 'fraction', imported: MACHINING_DEFAULTS.assemblyMarkup, max: 1000 },
    { key: 'assemblyShippingRate', label: 'Assembly shipping', hint: '', stored: 'fraction', imported: MACHINING_DEFAULTS.assemblyShippingRate, max: 1000 },
  ] },
];

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const toPct = (f: MarkupField, v: number): number => round((f.stored === 'multiplier' ? v - 1 : v) * 100);
const fromPct = (f: MarkupField, pct: number): number => round(f.stored === 'multiplier' ? 1 + pct / 100 : pct / 100);

export interface MarkupView {
  department: string; name: string; updatedByName: string | null; updatedAt: string | null;
  fields: { key: string; label: string; hint: string; pct: number; importedPct: number; max: number }[];
}

async function settingsRow(db: Queryable, department: string): Promise<{ data: Record<string, unknown>; updatedByName: string | null; updatedAt: string | null }> {
  const row = (await referenceRows(db, department, 'setting')).find((r) => r.key === 'calculation');
  const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
  return { data, updatedByName: row?.updatedByName ?? null, updatedAt: row ? row.updatedAt : null };
}

export async function markups(db: Queryable): Promise<MarkupView[]> {
  const out: MarkupView[] = [];
  for (const g of GROUPS) {
    const row = await settingsRow(db, g.department);
    out.push({
      department: g.department, name: g.name, updatedByName: row.updatedByName, updatedAt: row.updatedAt,
      fields: g.fields.map((f) => {
        const v = row.data[f.key];
        return { key: f.key, label: f.label, hint: f.hint, pct: toPct(f, typeof v === 'number' && Number.isFinite(v) ? v : f.imported), importedPct: toPct(f, f.imported), max: f.max };
      }),
    });
  }
  return out;
}

/** Sets one figure, as a percent, keeping every other figure in the department's settings. */
export async function setMarkup(db: Database, actor: Account, department: string, key: string, pct: unknown): Promise<void> {
  const g = GROUPS.find((x) => x.department === department);
  const f = g?.fields.find((x) => x.key === key);
  if (!g || !f) throw new HttpError(404, 'No such markup.');
  const n = Number(pct);
  const max = f.max;
  if (pct === null || pct === '' || !Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `${f.label} is a percent from 0 to ${max}.`);
  const row = await settingsRow(db, department);
  await setReference(db, actor, { department, kind: 'setting', key: 'calculation', data: { ...row.data, [f.key]: fromPct(f, n) } });
}
