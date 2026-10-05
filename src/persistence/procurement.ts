// Procurement's side of a quote: the vendors' quotes for a purchased part, and the part's price made
// from the one chosen.
import type { Database, Queryable } from '../server/db.ts';
import type { Account } from './accounts.ts';
import { audit, HttpError } from './util.ts';
import { rateProblem, vendorPrices, type Rates } from '../quoting/procurement.ts';
import { lineQuantities } from '../quoting/sheet.ts';
import { saveEstimate } from './quotes.ts';

export interface VendorQuote {
  id: number;
  supplierId: number;
  supplierName: string;
  reference: string;
  moq: number | null;
  leadTimeWeeks: number | null;
  tooling: number;
  nre: number;
  notes: string;
  prices: { quantity: number; unitCost: number }[];
  enteredByName: string;
  enteredAt: string;
}

const canProcure = (a: Account) => (a.role === 'estimator' && a.department === 'procurement') || a.role === 'manager' || a.role === 'administrator';
const requireProcurement = (a: Account) => {
  if (!canProcure(a)) throw new HttpError(403, 'Only Procurement, managers and administrators can enter vendor quotes.');
};

export async function vendorQuotes(db: Queryable, lineId: number): Promise<VendorQuote[]> {
  const rows = await db.query<{ id: number; supplier_id: number; supplier_name: string; reference: string; moq: string | null; lead_time_weeks: string | null; tooling: string; nre: string; notes: string; entered_by_name: string; entered_at: string; prices: { quantity: string; unit_cost: string }[] }>(
    `SELECT v.id, v.supplier_id, s.name AS supplier_name, v.reference, v.moq, v.lead_time_weeks, v.tooling, v.nre, v.notes, u.display_name AS entered_by_name, v.entered_at,
            coalesce((SELECT json_agg(json_build_object('quantity', p.quantity, 'unit_cost', p.unit_cost) ORDER BY p.quantity) FROM quote.vendor_quote_price p WHERE p.vendor_quote_id = v.id), '[]') AS prices
       FROM quote.vendor_quote v JOIN quote.supplier s ON s.id = v.supplier_id JOIN app.user_account u ON u.id = v.entered_by
      WHERE v.line_id = $1 AND v.removed_at IS NULL ORDER BY v.entered_at`, [lineId]);
  return rows.map((r) => ({
    id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name, reference: r.reference, moq: r.moq === null ? null : Number(r.moq), leadTimeWeeks: r.lead_time_weeks === null ? null : Number(r.lead_time_weeks),
    tooling: Number(r.tooling), nre: Number(r.nre), notes: r.notes, prices: r.prices.map((p) => ({ quantity: Number(p.quantity), unitCost: Number(p.unit_cost) })), enteredByName: r.entered_by_name, enteredAt: r.entered_at,
  }));
}

export async function suppliers(db: Queryable): Promise<{ id: number; name: string }[]> {
  return db.query<{ id: number; name: string }>('SELECT id, name FROM quote.supplier ORDER BY name');
}

const optNum = (v: unknown, what: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${what} must be zero or more.`);
  return n;
};

export async function addVendorQuote(db: Database, actor: Account, lineId: number, input: { supplierName?: unknown; reference?: unknown; moq?: unknown; leadTimeWeeks?: unknown; tooling?: unknown; nre?: unknown; notes?: unknown; prices?: unknown }): Promise<number> {
  requireProcurement(actor);
  const name = typeof input.supplierName === 'string' ? input.supplierName.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new HttpError(400, 'Name the vendor.');
  if (!Array.isArray(input.prices) || input.prices.length === 0) throw new HttpError(400, 'Enter at least one quantity and price from the vendor.');
  const prices = (input.prices as { quantity?: unknown; unitCost?: unknown }[]).map((p) => {
    const quantity = Number(p.quantity);
    const unitCost = Number(p.unitCost);
    if (!(quantity > 0) || !Number.isFinite(unitCost) || unitCost < 0) throw new HttpError(400, "Each vendor price needs a quantity above zero and a cost of zero or more.");
    return { quantity, unitCost };
  });
  if (new Set(prices.map((p) => p.quantity)).size !== prices.length) throw new HttpError(400, 'A quantity appears twice.');
  return db.transaction(async (tx) => {
    const line = (await tx.query<{ quote_id: number }>("SELECT l.quote_id FROM quote.line l JOIN quote.quote q ON q.id = l.quote_id WHERE l.id = $1 AND l.removed_at IS NULL AND q.status = 'estimating'", [lineId]))[0];
    if (!line) throw new HttpError(409, 'Vendor quotes can be entered only on a part of a quote being estimated.');
    const found = await tx.query<{ id: number }>('SELECT id FROM quote.supplier WHERE lower(btrim(name)) = lower($1)', [name]);
    const supplierId = found[0]?.id ?? (await tx.query<{ id: number }>('INSERT INTO quote.supplier (name) VALUES ($1) RETURNING id', [name]))[0]?.id;
    const rows = await tx.query<{ id: number }>(
      'INSERT INTO quote.vendor_quote (line_id, supplier_id, reference, moq, lead_time_weeks, tooling, nre, notes, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [lineId, supplierId, typeof input.reference === 'string' ? input.reference.trim().slice(0, 100) : '', optNum(input.moq, 'Minimum order'), optNum(input.leadTimeWeeks, 'Lead time'),
        optNum(input.tooling, 'Tooling') ?? 0, optNum(input.nre, 'NRE') ?? 0, typeof input.notes === 'string' ? input.notes.trim().slice(0, 2000) : '', actor.id]);
    const id = rows[0]?.id as number;
    for (const p of prices) await tx.query('INSERT INTO quote.vendor_quote_price (vendor_quote_id, quantity, unit_cost) VALUES ($1, $2, $3)', [id, p.quantity, p.unitCost]);
    await audit(tx, actor.id, 'vendor_quote.added', 'line', lineId, { vendorQuote: id, supplier: name });
    return id;
  });
}

export async function removeVendorQuote(db: Database, actor: Account, id: number): Promise<void> {
  requireProcurement(actor);
  const rows = await db.query<{ line_id: number }>('UPDATE quote.vendor_quote SET removed_at = now() WHERE id = $1 AND removed_at IS NULL RETURNING line_id', [id]);
  if (!rows[0]) throw new HttpError(404, 'No such vendor quote.');
  await audit(db, actor.id, 'vendor_quote.removed', 'line', rows[0].line_id, { vendorQuote: id });
}

/** Prices the part from one vendor's quote with scrap, freight and markup, and saves it as Procurement's estimate. */
export async function priceFromVendor(db: Database, actor: Account, lineId: number, input: { vendorQuoteId?: unknown; scrapPct?: unknown; freightPct?: unknown; markupPct?: unknown; notes?: unknown }): Promise<void> {
  requireProcurement(actor);
  const rates: Rates = { scrapPct: Number(input.scrapPct ?? 0), freightPct: Number(input.freightPct ?? 0), markupPct: Number(input.markupPct ?? 0) };
  const problem = rateProblem(rates);
  if (problem) throw new HttpError(400, problem);
  const line = (await db.query<{ qty_per: string; quantities: string[]; quote_quantities: number[] }>(
    'SELECT l.qty_per, l.quantities, q.quantities AS quote_quantities FROM quote.line l JOIN quote.quote q ON q.id = l.quote_id WHERE l.id = $1 AND l.removed_at IS NULL', [lineId]))[0];
  if (!line) throw new HttpError(404, 'No such part.');
  const vq = (await vendorQuotes(db, lineId)).find((v) => v.id === Number(input.vendorQuoteId));
  if (!vq) throw new HttpError(404, 'Choose one of this part\'s vendor quotes.');
  const quantities = lineQuantities(line.quote_quantities.map(Number), { id: lineId, qtyPer: Number(line.qty_per), quantities: line.quantities.map(Number) });
  const prices = vendorPrices(vq.prices, quantities, rates, vq.moq);
  const missing = prices.filter((p) => p.unitPrice === null);
  if (missing.length) throw new HttpError(400, `${vq.supplierName} has no price for ${missing.map((p) => p.quantity).join(', ')}: ${missing[0]?.warning ?? ''}`);
  const oneTime = vq.tooling + vq.nre;
  await saveEstimate(db, actor, lineId, {
    basis: 'vendor_quote',
    prices: prices.map((p) => ({ quantity: p.quantity, unitPrice: p.unitPrice })),
    oneTimeCost: oneTime,
    oneTimeLabel: [vq.tooling ? 'Tooling' : '', vq.nre ? 'NRE' : ''].filter(Boolean).join(' and '),
    leadTimeWeeks: vq.leadTimeWeeks,
    notes: typeof input.notes === 'string' ? input.notes : `${vq.supplierName}${vq.reference ? ` quote ${vq.reference}` : ''}.`,
    inputs: { vendorQuoteId: vq.id, ...rates },
    detail: { supplier: vq.supplierName, reference: vq.reference, rows: prices },
  });
}
