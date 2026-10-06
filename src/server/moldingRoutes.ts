// The Molding (ADC) calculator's API: its resins, presses and rates, and a part priced with it --
// worked out on the server, so the price saved is the price shown. The model is ADC's "Tool
// Development Form" as the old SnapQuote ran it (src/pricing/molding).
import type { Router, Response } from 'express';
import type { Database, Queryable } from './db.ts';
import type { Account } from '../persistence/accounts.ts';
import { HttpError } from '../persistence/util.ts';
import { referenceRows } from '../persistence/reference.ts';
import { saveEstimate } from '../persistence/quotes.ts';
import { lineBreaks } from './metalsRoutes.ts';
import { moldingProblems, parseMoldingSettings, priceMolding, type MoldingInput, type MoldingPress, type MoldingResin, type MoldingResult, type MoldingSettings } from '../pricing/molding/index.ts';

export async function moldingCatalog(db: Queryable): Promise<{ resins: MoldingResin[]; presses: MoldingPress[]; settings: MoldingSettings }> {
  const rows = (await referenceRows(db, 'molding')).filter((r) => r.active);
  return {
    resins: rows.filter((r) => r.kind === 'resin').map((r) => r.data as MoldingResin).sort((a, b) => a.sortOrder - b.sortOrder),
    presses: rows.filter((r) => r.kind === 'press').map((r) => r.data as MoldingPress).sort((a, b) => a.sortOrder - b.sortOrder),
    settings: parseMoldingSettings(rows.find((r) => r.kind === 'setting' && r.key === 'calculation')?.data ?? null),
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The calculator's inputs from a request, every field typed; anything else is dropped. */
export function moldingInputOf(raw: unknown): MoldingInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = (o['tool'] && typeof o['tool'] === 'object' ? o['tool'] : {}) as Record<string, unknown>;
  const tooling = str(o['tooling']);
  return {
    resin: str(o['resin']), pressId: str(o['pressId']) || null,
    eau: num(o['eau']), cavitation: num(o['cavitation']), cycleTimeSec: num(o['cycleTimeSec']), partVolumeIn3: num(o['partVolumeIn3']),
    wallThicknessIn: num(o['wallThicknessIn']), runnerLengthIn: num(o['runnerLengthIn']), footprintIn2: num(o['footprintIn2']), moldingPressure: num(o['moldingPressure']),
    flowLengthIn: num(o['flowLengthIn']), partLengthIn: num(o['partLengthIn']), partWidthIn: num(o['partWidthIn']), partHeightIn: num(o['partHeightIn']),
    tool: {
      steelType: str(t['steelType']) || 'P20', moldType: str(t['moldType']) || '2 Plate', sideActionQty: num(t['sideActionQty']), gateType: str(t['gateType']) || 'Center Sprue',
      gatesCount: num(t['gatesCount']), runnerType: str(t['runnerType']) || 'Cold Runner', ejectionSide: str(t['ejectionSide']) || 'Standard', complexity: num(t['complexity']),
      domesticUsd: num(t['domesticUsd']), chinaUsd: num(t['chinaUsd']), portugalUsd: num(t['portugalUsd']),
    },
    tooling: tooling === 'china' || tooling === 'portugal' || tooling === 'none' ? tooling : 'domestic',
  };
}

export function moldingRoutes(api: Router, db: Database, me: (res: Response) => Account): void {
  api.get('/molding/catalog', async (_req, res) => {
    res.json(await moldingCatalog(db));
  });

  // Prices a part with the calculator. With save: true the result becomes Molding's estimate for it.
  api.post('/lines/:id/molding', async (req, res) => {
    const lineId = Number(req.params['id']);
    if (!Number.isSafeInteger(lineId) || lineId <= 0) throw new HttpError(400, 'Bad line.');
    const b = (req.body ?? {}) as { input?: unknown; save?: boolean; leadTimeWeeks?: unknown; notes?: unknown };
    const line = await lineBreaks(db, lineId);
    if (line.department !== 'molding') throw new HttpError(409, 'This part is not priced by Molding (ADC).');
    if (!line.breaks.length) throw new HttpError(409, 'The quote has no quantities yet.');
    const input = moldingInputOf(b.input);
    const { resins, presses, settings } = await moldingCatalog(db);
    const problems = moldingProblems(input, resins, presses);
    const result: MoldingResult | null = problems.length ? null : priceMolding(input, settings, resins, presses);
    if (b.save) {
      if (!result) throw new HttpError(400, problems.join(' '));
      // One price per piece at every quantity: setup is spread over the year's volume, not the quantity.
      const pieces = line.breaks.map((q) => q * line.partsPerAssembly);
      await saveEstimate(db, me(res), lineId, {
        basis: 'calculator',
        prices: pieces.map((q) => ({ quantity: q, unitPrice: result.perPart })),
        oneTimeCost: result.tool.oneTimeUsd,
        oneTimeLabel: result.tool.oneTimeLabel,
        leadTimeWeeks: b.leadTimeWeeks,
        notes: b.notes,
        inputs: input,
        detail: { calculator: 'molding', ...result },
      });
    }
    res.json({ result, problems });
  });
}
