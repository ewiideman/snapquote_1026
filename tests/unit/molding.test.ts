// The Molding (ADC) calculator against the old SnapQuote's own fixture (src/utils/calc.test.ts at
// 5920baa), whose expected values the port reproduces. Checked the day of the port against the old
// calculatePartOutputs and selectPress on 5,000 random parts: every output identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOLDING_DEFAULTS, MOLDING_PRESSES, MOLDING_RESINS, moldingProblems, priceMolding, rungFor, selectPress, type MoldingInput, type MoldingPress, type MoldingResin } from '../../src/pricing/molding/index.ts';

const resin: MoldingResin = { name: 'TEST', densityLbPerIn3: 0.037, pricePerLb: 1.65, barrelMaxPct: 80, barrelMinPct: 15, sortOrder: 1 };
const press165: MoldingPress = { id: 'TEST_165', plant: 'Test', number: '1', tons: 165, barrelOz: 28, make: null, type: null, maxTruckLb: 35000, maxCraneLb: 50000, platenLengthIn: 23.6, platenWidthIn: 23.6, sortOrder: 1 };
const input: MoldingInput = {
  resin: 'TEST', pressId: 'TEST_165', eau: 50000, cavitation: 2, cycleTimeSec: 45, partVolumeIn3: 2.5, wallThicknessIn: 0.15, runnerLengthIn: 8,
  footprintIn2: 32, moldingPressure: 4000, flowLengthIn: 6, partLengthIn: 8, partWidthIn: 4, partHeightIn: 1.5,
  tool: { steelType: 'P20', moldType: '2 Plate', sideActionQty: 0, gateType: 'Edge Gate', gatesCount: 2, runnerType: 'Cold Runner', ejectionSide: 'Standard', complexity: 3 },
  tooling: 'domestic',
};

test('the old fixture: weights, piece cost and process figures', () => {
  const r = priceMolding(input, MOLDING_DEFAULTS, [resin], [press165]);
  assert.equal(r.partWeightOz, 1.48);
  assert.equal(r.runnerWeightOz, 0.21);
  assert.equal(r.shotWeightOz, 3.17);
  assert.equal(r.materialPerPart, 0.21);
  assert.equal(r.moldingPerPart, 0.8421, '$128/h over 152 parts an hour');
  assert.equal(r.setupPerPart, 0.00752, '165 tons is in a gap of the setup table: $94 × 4 ÷ 50,000');
  assert.equal(r.perPart, 1.0596);
  assert.deepEqual(
    [r.process.minTonnage, r.process.shotToBarrelPct, r.process.minBarrelOz, r.process.maxBarrelOz, r.process.flowRatio, r.process.pressDaysPerYear, r.process.pressUtilizationPct, r.process.resinLbPerYear, r.process.dryerLbPerHour, r.process.hopperLb],
    [281600, 11, 4, 22, 40, 14, 5.6, 11392.2, 16, 0]);
  assert.ok(r.warnings.some((w) => /no row for a 165-ton press/.test(w)), 'the gap is said, not hidden');
});

test('the old fixture: the mold, domestic, China and Portugal', () => {
  const r = priceMolding(input, MOLDING_DEFAULTS, [resin], [press165]);
  assert.ok(Math.abs(r.tool.weightLb - 718.52) < 1e-9);
  assert.ok(Math.abs(r.tool.domestic - 58887.6312) < 1e-6);
  assert.ok(Math.abs(r.tool.china - 23555.05248) < 1e-6);
  assert.ok(Math.abs(r.tool.portugal - 52998.86808) < 1e-6);
  assert.deepEqual([r.tool.oneTimeUsd, r.tool.oneTimeLabel], [58887.63, 'Mold (domestic)']);
  const china = priceMolding({ ...input, tooling: 'china' }, MOLDING_DEFAULTS, [resin], [press165]);
  assert.deepEqual([china.tool.oneTimeUsd, china.tool.oneTimeLabel], [23555.05, 'Mold (China)']);
  const own = priceMolding({ ...input, tool: { ...input.tool, domesticUsd: 61000 } }, MOLDING_DEFAULTS, [resin], [press165]);
  assert.equal(own.tool.domestic, 61000, "ADC's own figure is used when given");
  assert.ok(Math.abs(own.tool.china - 23555.05248) < 1e-6, 'and does not move the computed China price');
  assert.equal(priceMolding({ ...input, tooling: 'none' }, MOLDING_DEFAULTS, [resin], [press165]).tool.oneTimeUsd, 0);
});

test('the setup table reads as the old if-chain, rung order and gaps included', () => {
  const s = MOLDING_DEFAULTS.setupCost;
  assert.deepEqual([2300, 2100, 1650, 1700, 1500, 1000, 750, 600, 500, 400, 350, 300, 230, 170, 120, 60, 501].map((t) => rungFor(s, t).usd),
    [19281, 17945, 94, 14380, 12690, 10272, 7597, 7079, 6694, 6652, 6136, 5896, 5127, 94, 4483, 94, 94]);
  assert.equal(rungFor(s, 1650).matched, false);
  assert.deepEqual([2400, 1650, 1100, 900, 700, 500, 390, 170, 100, 60].map((t) => rungFor(MOLDING_DEFAULTS.pressRate, t).usd), [482, 383, 317, 257, 192, 152, 142, 128, 112, 94]);
});

test('with no press chosen, the smallest that fits is taken, from the real press list', () => {
  const abs = MOLDING_RESINS.find((r) => r.name === 'ABS');
  assert.ok(abs);
  const small = { ...input, resin: 'ABS', pressId: null, moldingPressure: 2, footprintIn2: 20, partVolumeIn3: 1 };
  const p = selectPress(small, abs, MOLDING_PRESSES);
  assert.ok(p && p.tons >= 1.1 * 2 * 2 * 20);
  const r = priceMolding(small, MOLDING_DEFAULTS, MOLDING_RESINS, MOLDING_PRESSES);
  assert.equal(r.press?.chosen, 'smallest_that_fits');
  assert.equal(r.press?.id, p?.id);
});

test('what is missing is said before any price', () => {
  const blank: MoldingInput = { ...input, pressId: null, resin: '', eau: null, cavitation: null, cycleTimeSec: null, partVolumeIn3: null };
  assert.deepEqual(moldingProblems(blank, MOLDING_RESINS, MOLDING_PRESSES), ['Choose a resin.', 'Annual volume (EAU) is needed.', 'Cavities is needed.', 'Cycle time is needed.', 'Part volume is needed.']);
  const unpriced = MOLDING_RESINS.find((r) => r.pricePerLb === 0);
  assert.ok(unpriced, 'the old list has resins with no price');
  assert.match(moldingProblems({ ...input, resin: unpriced.name, pressId: null }, MOLDING_RESINS, MOLDING_PRESSES).join(' '), /has no price per pound/);
  assert.throws(() => priceMolding(blank, MOLDING_DEFAULTS, MOLDING_RESINS, MOLDING_PRESSES), /Choose a resin/);
});

test('the reference lists came over whole: 46 resins and 53 presses', () => {
  assert.equal(MOLDING_RESINS.length, 46);
  assert.equal(MOLDING_PRESSES.length, 53);
  assert.equal(new Set(MOLDING_PRESSES.map((p) => p.id)).size, 53);
  assert.deepEqual(MOLDING_RESINS.filter((r) => r.pricePerLb === 0).map((r) => r.name).sort(), ['PSU - 30% GF', 'UHMWPE']);
});
