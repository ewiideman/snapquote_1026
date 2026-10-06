// The Machining calculator against the old SnapQuote's own fixtures (backend-postgres/tests/machined at
// 5920baa): the workbook example, its prices as "SNAPQUOTE EXCEL TEMPLATE.xlsx" gives them, and as the
// corrected baseline gives them. Checked the day of the port against the old engine on 3,000 random
// parts (279,000 values): every one identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MACHINING_DEFAULTS, MACHINING_MACHINES, MACHINING_STOCK, aqlSampleSize, machiningProblems, priceMachining, type MachiningInput } from '../../src/pricing/machining/index.ts';

const workbook: MachiningInput = {
  primaryMachine: 'A20', primaryCycleSec: 70, primarySetupHours: 2, primaryDutyCycle: 0.5, primaryLeadWeeks: 3,
  secondaryMachine: null, secondaryCycleSec: null, secondarySetupHours: null, secondaryDutyCycle: null, secondaryLeadWeeks: null,
  operatingShifts: 2, deburr: false, partsPerDeburrCycle: null, sandblast: false, partsPerSandblastCycle: null,
  cleaning: true, partsPerCleaningCycle: 500, partMarking: false, packaging: 'BULK', partsPerBox: 500, costPerBox: 0.15,
  perishableToolingPct: 0.06, programmingHours: 1, programmingAmortized: true, programmingLeadWeeks: 1,
  material: { mode: 'STOCKED', partNumber: 'BR303SS00625042', rawLengthIn: 48.71 / 25.4, remnantIn: 10 },
  workholding: { cost: 0, amortized: false, leadWeeks: null }, tooling: { cost: 0, amortized: false, leadWeeks: null }, gaging: { cost: 400, amortized: false, leadWeeks: 0 },
  inspectionLevel: 'AQL 4.0', inspectionDifficulty: 'B',
  fai: { required: true, parts: 1, leadWeeks: 0 }, capStudy: { required: false, featuresXParts: 150, leadWeeks: null }, gageRr: { required: false, studies: 2, leadWeeks: null },
  coc: false, assemblyOps: [], outsideOps: [],
};
const QTYS = [10, 40, 50, 100, 20000, 50000];
const near = (a: number | undefined, b: number, eps: number) => assert.ok(a !== undefined && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('the workbook example, with the workbook\'s 15-minute cleaning: its prices to 1e-6', () => {
  const r = priceMachining(workbook, QTYS, { ...MACHINING_DEFAULTS, cleaningCycleMinutes: 15 }, MACHINING_MACHINES, MACHINING_STOCK);
  const expected = [56.65188127544097, 17.665631275440976, 15.019881275440978, 9.448381275440976, 3.819531275440978, 3.798921275440977];
  r.breaks.forEach((b, i) => near(b['selling_price_each'], expected[i] as number, 1e-6));
  const q10 = r.breaks[0];
  near(q10?.['primary_machining_cost'], 22.75, 1e-9);
  near(q10?.['cleaning_cost'], 18, 1e-9);
  near(q10?.['packaging_cost'], 6.15, 1e-9);
  near(q10?.['aql_inspection_cost'], 21, 1e-9);
  assert.equal(q10?.['parts_per_bar'], 67);
  assert.equal(q10?.['nre_cost'], 400);
  near(q10?.['lead_time'], 4.002880658436214, 1e-9);
  near(q10?.['revenue'], 566.5188127544097, 1e-9);
  near(q10?.['value_add'], 0.9805040120233462, 1e-9);
  assert.equal(r.nreCost, 400, 'the gaging, not amortized, is the one-time charge');
});

test('the same example with the corrected baseline (cleaning 10 minutes, as the label says)', () => {
  const r = priceMachining(workbook, QTYS, MACHINING_DEFAULTS, MACHINING_MACHINES, MACHINING_STOCK);
  [56.051881, 17.515631, 14.899881, 9.388381, 3.807531, 3.786921].forEach((p, i) => near(r.breaks[i]?.['selling_price_each'], p, 1e-4));
});

test('the old scenario checks', () => {
  const base: MachiningInput = { ...workbook, primaryCycleSec: 60, primarySetupHours: 0, primaryDutyCycle: 1, operatingShifts: 1, cleaning: false, packaging: 'NONE', perishableToolingPct: 0,
    programmingHours: 0, gaging: { cost: 0, amortized: false, leadWeeks: 0 }, inspectionLevel: 'NONE', fai: { required: false, parts: 0, leadWeeks: 0 },
    material: { mode: 'CUSTOM', unitPrice: 5, stockLengthIn: null, rawLengthIn: null, remnantIn: null } };
  const one = (i: MachiningInput) => priceMachining(i, [100], MACHINING_DEFAULTS, MACHINING_MACHINES, MACHINING_STOCK).breaks[0];
  near(one(base)?.['primary_machining_cost'], 100 * (60 / 3600) * 153, 1e-12);
  near(one({ ...base, primaryDutyCycle: 0 })?.['primary_machining_cost'], 100 * (60 / 3600) * (153 - 72), 1e-12);
  assert.equal(one(base)?.['raw_material_cost'], 500);
  near(one({ ...base, inspectionLevel: '100%' })?.['aql_inspection_cost'], 100 * 5 * 1 * (60 / 3600) * 72, 1e-12);
  assert.equal(one({ ...base, programmingHours: 2, programmingAmortized: true })?.['programming_cost'], 356);
  assert.equal(one({ ...base, programmingHours: 2, programmingAmortized: false })?.['nre_cost'], 356);
  near(one({ ...base, assemblyOps: [{ label: '', costEach: 10, ship: true, leadWeeks: 0 }] })?.['assembly_cost'], 1200.6, 1e-12);
  near(one({ ...base, outsideOps: [{ label: '', costEach: 2, lotCharge: 500, leadWeeks: 0 }] })?.['outside_operation_cost'], 6.24, 1e-12);
});

test('the AQL table reads as the workbook LOOKUP', () => {
  assert.deepEqual([3, 8, 10, 100, 500, 499].map((q) => aqlSampleSize(MACHINING_DEFAULTS, 'AQL 4.0', q)), [3, 3, 3, 9, 15, 11]);
  assert.equal(aqlSampleSize(MACHINING_DEFAULTS, '100%', 77), 77);
  assert.equal(aqlSampleSize(MACHINING_DEFAULTS, 'NONE', 77), 0);
});

test('what is missing is said, and what the old engine assumed is asked', () => {
  const blank: MachiningInput = { ...workbook, primaryMachine: '', primaryCycleSec: null, primaryDutyCycle: null, material: { mode: 'STOCKED', partNumber: '', rawLengthIn: null, remnantIn: null } };
  assert.deepEqual(machiningProblems(blank, MACHINING_MACHINES, MACHINING_STOCK), [
    'Choose the machine.', 'Cycle time is needed.', 'Operator time on the machine (0 to 1) is needed.',
    'Choose the bar stock, or enter a custom material price.', 'Length of stock per part is needed.']);
  const free = MACHINING_STOCK.find((s) => s.costPerBar === 0);
  assert.ok(free);
  assert.match(machiningProblems({ ...workbook, material: { mode: 'STOCKED', partNumber: free.partNumber, rawLengthIn: 2, remnantIn: 0 } }, MACHINING_MACHINES, MACHINING_STOCK).join(' '), /has no cost per bar/);
  assert.match(machiningProblems({ ...workbook, primaryMachine: 'NOPE' }, MACHINING_MACHINES, MACHINING_STOCK).join(' '), /not in the machine list/);
});

test('the reference lists came over whole: 9 machines and 614 bars', () => {
  assert.equal(MACHINING_MACHINES.length, 9);
  assert.equal(MACHINING_STOCK.length, 614);
  assert.equal(MACHINING_STOCK.filter((s) => s.costPerBar === 0).length, 87);
});
