// The Machining and Assembly calculators' API: their reference data, and a part priced with each --
// worked out on the server, so the price saved is the price shown.
import type { Router, Response } from 'express';
import type { Database, Queryable } from './db.ts';
import type { Account } from '../persistence/accounts.ts';
import { HttpError } from '../persistence/util.ts';
import { referenceRows } from '../persistence/reference.ts';
import { saveEstimate } from '../persistence/quotes.ts';
import { lineBreaks } from './metalsRoutes.ts';
import { machiningProblems, parseMachiningSettings, priceMachining, type MachiningInput, type MachiningMachine, type MachiningStock } from '../pricing/machining/index.ts';
import { ASSEMBLY_DEFAULTS, assemblyProblems, priceAssembly, type AssemblyInput, type AssemblySettings } from '../pricing/assembly/engine.ts';

export async function machiningCatalog(db: Queryable) {
  const rows = (await referenceRows(db, 'machining')).filter((r) => r.active);
  return {
    machines: rows.filter((r) => r.kind === 'machine').map((r) => r.data as MachiningMachine).sort((a, b) => a.sortOrder - b.sortOrder),
    stock: rows.filter((r) => r.kind === 'stock').map((r) => r.data as MachiningStock).sort((a, b) => a.sortOrder - b.sortOrder),
    settings: parseMachiningSettings(rows.find((r) => r.kind === 'setting' && r.key === 'calculation')?.data ?? null),
  };
}

async function assemblySettings(db: Queryable): Promise<AssemblySettings> {
  const row = (await referenceRows(db, 'assembly', 'setting')).find((r) => r.active && r.key === 'calculation');
  const rate = (row?.data as { laborRatePerHour?: unknown } | undefined)?.laborRatePerHour;
  return { laborRatePerHour: typeof rate === 'number' && rate >= 0 ? rate : ASSEMBLY_DEFAULTS.laborRatePerHour };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown, max: number): Record<string, unknown>[] => (Array.isArray(v) ? v.slice(0, max).map(obj) : []);
const flag = (v: unknown): boolean => v === true;

/** The Machining calculator's inputs from a request, every field typed; anything else is dropped. */
export function machiningInputOf(raw: unknown): MachiningInput {
  const o = obj(raw);
  const m = obj(o['material']);
  const lot = (k: string) => { const x = obj(o[k]); return { cost: num(x['cost']), amortized: flag(x['amortized']), leadWeeks: num(x['leadWeeks']) }; };
  const level = str(o['inspectionLevel']);
  const diff = str(o['inspectionDifficulty']);
  const pack = str(o['packaging']);
  return {
    primaryMachine: str(o['primaryMachine']), primaryCycleSec: num(o['primaryCycleSec']), primarySetupHours: num(o['primarySetupHours']), primaryDutyCycle: num(o['primaryDutyCycle']), primaryLeadWeeks: num(o['primaryLeadWeeks']),
    secondaryMachine: str(o['secondaryMachine']) || null, secondaryCycleSec: num(o['secondaryCycleSec']), secondarySetupHours: num(o['secondarySetupHours']), secondaryDutyCycle: num(o['secondaryDutyCycle']), secondaryLeadWeeks: num(o['secondaryLeadWeeks']),
    operatingShifts: num(o['operatingShifts']),
    deburr: flag(o['deburr']), partsPerDeburrCycle: num(o['partsPerDeburrCycle']), sandblast: flag(o['sandblast']), partsPerSandblastCycle: num(o['partsPerSandblastCycle']),
    cleaning: flag(o['cleaning']), partsPerCleaningCycle: num(o['partsPerCleaningCycle']), partMarking: flag(o['partMarking']),
    packaging: pack === 'BULK' || pack === 'SEPARATE' ? pack : 'NONE', partsPerBox: num(o['partsPerBox']), costPerBox: num(o['costPerBox']),
    perishableToolingPct: num(o['perishableToolingPct']), programmingHours: num(o['programmingHours']), programmingAmortized: flag(o['programmingAmortized']), programmingLeadWeeks: num(o['programmingLeadWeeks']),
    material: m['mode'] === 'CUSTOM'
      ? { mode: 'CUSTOM', unitPrice: num(m['unitPrice']), stockLengthIn: num(m['stockLengthIn']), rawLengthIn: num(m['rawLengthIn']), remnantIn: num(m['remnantIn']) }
      : { mode: 'STOCKED', partNumber: str(m['partNumber']), rawLengthIn: num(m['rawLengthIn']), remnantIn: num(m['remnantIn']) },
    workholding: lot('workholding'), tooling: lot('tooling'), gaging: lot('gaging'),
    inspectionLevel: (['AQL 1.0', 'AQL 1.5', 'AQL 2.5', 'AQL 4.0', '100%'].includes(level) ? level : 'NONE') as MachiningInput['inspectionLevel'],
    inspectionDifficulty: (['A', 'B', 'C', 'D'].includes(diff) ? diff : 'B') as MachiningInput['inspectionDifficulty'],
    fai: { required: flag(obj(o['fai'])['required']), parts: num(obj(o['fai'])['parts']), leadWeeks: num(obj(o['fai'])['leadWeeks']) },
    capStudy: { required: flag(obj(o['capStudy'])['required']), featuresXParts: num(obj(o['capStudy'])['featuresXParts']), leadWeeks: num(obj(o['capStudy'])['leadWeeks']) },
    gageRr: { required: flag(obj(o['gageRr'])['required']), studies: num(obj(o['gageRr'])['studies']), leadWeeks: num(obj(o['gageRr'])['leadWeeks']) },
    coc: flag(o['coc']),
    assemblyOps: arr(o['assemblyOps'], 20).map((x) => ({ label: str(x['label']), costEach: num(x['costEach']), ship: flag(x['ship']), leadWeeks: num(x['leadWeeks']) })),
    outsideOps: arr(o['outsideOps'], 20).map((x) => ({ label: str(x['label']), costEach: num(x['costEach']), lotCharge: num(x['lotCharge']), leadWeeks: num(x['leadWeeks']) })),
  };
}

export function assemblyInputOf(raw: unknown): AssemblyInput {
  const o = obj(raw);
  return {
    laborRatePerHour: num(o['laborRatePerHour']),
    sections: arr(o['sections'], 20).map((s) => ({
      name: str(s['name']), partsPerAssembly: num(s['partsPerAssembly']),
      steps: arr(s['steps'], 1000).map((r) => ({ label: str(r['label']), assemblySec: num(r['assemblySec']), testSec: num(r['testSec']), qaSec: num(r['qaSec']) })),
      equipment: arr(s['equipment'], 50).map((e) => ({ label: str(e['label']), cost: num(e['cost']), nre: num(e['nre']) })),
    })),
  };
}

async function lineFor(db: Queryable, lineIdRaw: unknown, department: string, name: string) {
  const lineId = Number(lineIdRaw);
  if (!Number.isSafeInteger(lineId) || lineId <= 0) throw new HttpError(400, 'Bad line.');
  const line = await lineBreaks(db, lineId);
  if (line.department !== department) throw new HttpError(409, `This part is not priced by ${name}.`);
  if (!line.breaks.length) throw new HttpError(409, 'The quote has no quantities yet.');
  return { lineId, pieces: line.breaks.map((q) => q * line.partsPerAssembly) };
}

export function machiningAssemblyRoutes(api: Router, db: Database, me: (res: Response) => Account): void {
  api.get('/machining/catalog', async (_req, res) => {
    const c = await machiningCatalog(db);
    res.json({ machines: c.machines, stock: c.stock, settings: c.settings });
  });

  // Prices a part with the Machining calculator. With save: true it becomes Machining's estimate.
  api.post('/lines/:id/machining', async (req, res) => {
    const { lineId, pieces } = await lineFor(db, req.params['id'], 'machining', 'Machining');
    const b = obj(req.body);
    const input = machiningInputOf(b['input']);
    const { machines, stock, settings } = await machiningCatalog(db);
    const problems = machiningProblems(input, machines, stock);
    const result = problems.length ? null : priceMachining(input, pieces, settings, machines, stock);
    if (b['save'] === true) {
      if (!result) throw new HttpError(400, problems.join(' '));
      await saveEstimate(db, me(res), lineId, {
        basis: 'calculator',
        // The price at each quantity carries that quantity's lot costs; non-amortized programming,
        // workholding, tooling and gaging are the one-time charge.
        prices: result.breaks.map((x) => ({ quantity: x.quantity, unitPrice: x['selling_price_each'] })),
        oneTimeCost: Math.round(result.nreCost * 100) / 100,
        oneTimeLabel: result.nreCost > 0 ? 'Programming, fixtures and gages' : '',
        leadTimeWeeks: b['leadTimeWeeks'] ?? Math.ceil(result.leadWeeks),
        notes: b['notes'],
        inputs: input,
        detail: { calculator: 'machining', ...result },
      });
    }
    res.json({ result, problems });
  });

  api.get('/assembly/settings', async (_req, res) => {
    res.json(await assemblySettings(db));
  });

  // Prices a part with the Assembly calculator. With save: true it becomes Assembly's estimate.
  api.post('/lines/:id/assembly', async (req, res) => {
    const { lineId, pieces } = await lineFor(db, req.params['id'], 'assembly', 'Assembly');
    const b = obj(req.body);
    const input = assemblyInputOf(b['input']);
    const problems = assemblyProblems(input);
    let result = null;
    if (!problems.length) {
      try { result = priceAssembly(input, await assemblySettings(db)); } catch (err) { problems.push((err as Error).message); }
    }
    if (b['save'] === true) {
      if (!result) throw new HttpError(400, problems.join(' '));
      await saveEstimate(db, me(res), lineId, {
        basis: 'calculator',
        prices: pieces.map((q) => ({ quantity: q, unitPrice: result.perUnit })),
        oneTimeCost: result.oneTimeUsd,
        oneTimeLabel: result.oneTimeUsd > 0 ? 'Equipment and tooling' : '',
        leadTimeWeeks: b['leadTimeWeeks'],
        notes: b['notes'],
        inputs: input,
        detail: { calculator: 'assembly', ...result },
      });
    }
    res.json({ result, problems });
  });
}
