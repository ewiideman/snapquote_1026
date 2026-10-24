// The Metals calculator's API: its reference data, and a part priced with it -- worked out on the
// server, so the price saved is the price shown. The engine is the old SnapQuote's (MTL07 model).
import type { Router, Response } from 'express';
import type { Database, Queryable } from './db.ts';
import type { Account } from '../persistence/accounts.ts';
import { HttpError } from '../persistence/util.ts';
import { referenceRows } from '../persistence/reference.ts';
import { saveEstimate } from '../persistence/quotes.ts';
import { deriveMetalsItemAttributes, parseMetalsCalculationSettings, priceMetalsLine, resolveNestingParams, validateMetalsLine, type MetalsCatalog, type MetalsLineInput, type MetalsLineResult, type MetalsMaterialItem, type MetalsWorkCell } from '../pricing/metals/index.ts';

export interface SheetFacts { thicknessIn: number; widthIn: number; lengthIn: number }

/**
 * The catalog, its settings, and for the screen what the engine reads from each sheet's item number
 * (thickness and size) and the nesting margins it uses, so the estimator sees what is already known.
 */
export async function metalsCatalog(db: Queryable): Promise<{ catalog: MetalsCatalog; settings: unknown; sheets: Record<string, SheetFacts>; nesting: { lengthMarginIn: number; widthMarginIn: number; webIn: number } }> {
  const rows = (await referenceRows(db, 'metals')).filter((r) => r.active);
  const materialItems = rows.filter((r) => r.kind === 'material').map((r) => r.data as MetalsMaterialItem).sort((a, b) => a.sortOrder - b.sortOrder);
  const settings = rows.find((r) => r.kind === 'setting' && r.key === 'calculation')?.data ?? null;
  const inch = (mm: number) => Math.round((mm / 25.4) * 1000) / 1000;
  const sheets: Record<string, SheetFacts> = {};
  for (const m of materialItems) {
    const a = deriveMetalsItemAttributes(m.itemNumber, m.description);
    if (a) sheets[m.itemNumber] = { thicknessIn: inch(a.thicknessMm), widthIn: inch(a.sheetWidthMm), lengthIn: inch(a.sheetLengthMm) };
  }
  const n = resolveNestingParams(undefined, parseMetalsCalculationSettings(settings));
  return {
    catalog: { workCells: rows.filter((r) => r.kind === 'work_cell').map((r) => r.data as MetalsWorkCell).sort((a, b) => a.sortOrder - b.sortOrder), materialItems },
    settings,
    sheets,
    nesting: { lengthMarginIn: n.lengthMarginIn, widthMarginIn: n.widthMarginIn, webIn: n.webIn },
  };
}

/** The line's breaks as the engine wants them: assemblies and parts per assembly, or the part's own quantities. */
export async function lineBreaks(db: Queryable, lineId: number): Promise<{ partNumber: string; description: string; partsPerAssembly: number; breaks: number[]; department: string | null }> {
  const r = (await db.query<{ part_number: string; description: string; qty_per: string; quantities: string[]; department: string | null; quote_quantities: number[] }>(
    'SELECT l.part_number, l.description, l.qty_per, l.quantities, l.department, q.quantities AS quote_quantities FROM quote.line l JOIN quote.quote q ON q.id = l.quote_id WHERE l.id = $1 AND l.removed_at IS NULL', [lineId]))[0];
  if (!r) throw new HttpError(404, 'No such part.');
  const own = r.quantities.map(Number);
  return own.length
    ? { partNumber: r.part_number, description: r.description, partsPerAssembly: 1, breaks: own, department: r.department }
    : { partNumber: r.part_number, description: r.description, partsPerAssembly: Number(r.qty_per), breaks: r.quote_quantities.map(Number), department: r.department };
}

export function metalsRoutes(api: Router, db: Database, me: (res: Response) => Account): void {
  api.get('/metals/catalog', async (_req, res) => {
    res.json(await metalsCatalog(db));
  });

  // Prices a part with the calculator. With save: true the result becomes Metals' estimate for it.
  api.post('/lines/:id/metals', async (req, res) => {
    const lineId = Number(req.params['id']);
    if (!Number.isSafeInteger(lineId) || lineId <= 0) throw new HttpError(400, 'Bad line.');
    const b = (req.body ?? {}) as { input?: Partial<MetalsLineInput>; save?: boolean; leadTimeWeeks?: unknown; notes?: unknown };
    const line = await lineBreaks(db, lineId);
    if (line.department !== 'metals') throw new HttpError(409, 'This part is not priced by Metals.');
    if (!line.breaks.length) throw new HttpError(409, 'The quote has no quantities yet.');
    const input: MetalsLineInput = {
      ...(b.input ?? {}),
      operations: Array.isArray(b.input?.operations) ? b.input.operations : [],
      partNumber: line.partNumber,
      description: line.description,
      partsPerAssembly: line.partsPerAssembly,
      quantityBreaks: line.breaks.map((q) => ({ label: String(q), assemblies: q })),
    };
    const { catalog, settings } = await metalsCatalog(db);
    const problems = validateMetalsLine(input, catalog);
    let result: MetalsLineResult;
    try {
      result = priceMetalsLine(input, parseMetalsCalculationSettings(settings), catalog);
    } catch (err) {
      throw new HttpError(400, `The calculator could not price this: ${(err as Error).message}`);
    }
    // A missing price stays missing, never zero: a part that is not labor only cannot be priced with $0 material.
    if (!problems.length && !input.laborOnly && result.breaks.some((x) => !(x.perPart.material > 0))) {
      problems.push('Material comes out at $0, so this price cannot be used. Choose a material with a sheet price, enter the blank size or part weight, or mark the part labor only.');
    }
    if (b.save) {
      if (problems.length) throw new HttpError(400, problems.join(' '));
      const bad = result.breaks.filter((x) => !Number.isFinite(x.unitPrice));
      if (bad.length) throw new HttpError(400, 'The calculator gave no price for some quantities. Check the inputs.');
      await saveEstimate(db, me(res), lineId, {
        basis: 'calculator',
        // Tooling is already spread over the parts by the calculator, so nothing is added as a one-time charge.
        prices: result.breaks.map((x) => ({ quantity: x.parts, unitPrice: x.unitPrice })),
        oneTimeCost: 0,
        leadTimeWeeks: b.leadTimeWeeks,
        notes: b.notes,
        inputs: b.input ?? {},
        detail: { breaks: result.breaks, warnings: result.warnings, sheetCosted: result.sheetCosted },
      });
    }
    res.json({ result, problems });
  });
}
