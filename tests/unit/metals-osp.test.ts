// Outside processing cost. Ported from SnapQuote 0626 src/utils/__tests__/metalsOspCost.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_DEFAULTS,
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  isOspPending,
  ospCostPerPart,
  ospRatesFromSettings,
  priceMetalsLine,
  type MetalsCatalog,
  type MetalsLineInput,
  type MetalsOspInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };
const RATES = ospRatesFromSettings(null);

function close(actual: number, expected: number, digits: number): void {
  assert.ok(Math.abs(expected - actual) < 10 ** -digits / 2, `expected ${expected}, got ${actual}`);
}

function req(over: Partial<MetalsOspInput> = {}): MetalsOspInput {
  return { description: 'Anodize Type II, Clear', status: 'quoted', unitPrice: 2, lotCharge: null, quantity: 500, ...over };
}

test("applies Mack's 20% markup then 11% freight", () => {
  close(ospCostPerPart(req(), RATES), 2 * (1 + METALS_DEFAULTS.ospMarkupPct) * (1 + METALS_DEFAULTS.ospFreightPct), 10);
  close(ospCostPerPart(req(), RATES), 2.664, 3);
});

test('spreads a lot charge across the request quantity', () => {
  close(ospCostPerPart(req({ lotCharge: 500, quantity: 500 }), RATES), 3 * 1.2 * 1.11, 10);
});

test('ignores a lot charge with no quantity to spread it over', () => {
  close(ospCostPerPart(req({ lotCharge: 500, quantity: null }), RATES), 2 * 1.2 * 1.11, 10);
});

test('costs nothing until Procurement has priced it', () => {
  assert.equal(ospCostPerPart(req({ status: 'sent', unitPrice: null }), RATES), 0);
  assert.equal(ospCostPerPart(req({ status: 'draft', unitPrice: null }), RATES), 0);
});

test('counts unpriced requests as pending, priced ones as settled', () => {
  const rows = [req({ status: 'draft', unitPrice: null }), req({ status: 'sent', unitPrice: null }), req(), req({ status: 'accepted' })];
  assert.deepEqual(rows.map(isOspPending), [true, true, false, false]);
});

test('org settings override the OSP rates', () => {
  close(ospCostPerPart(req(), ospRatesFromSettings({ ospMarkupPct: 0.3, ospFreightPct: 0 })), 2.6, 10);
});

const base: MetalsLineInput = {
  partNumber: 'P-1',
  quantityBreaks: [{ label: 'Low', assemblies: 100 }],
  blank: { lengthMm: 220, widthMm: 150, thicknessMm: 1.27 },
  material: { name: 'Al 5052-H32', stockForm: 'Sheet', densityKgPerM3: 2680, pricePerKg: 4.25 },
  operations: [{ name: 'Laser', setupHours: 10 / 60, runMinutesPerPiece: 1.5, ratePerHour: 333 }],
};
const priceOf = (l: MetalsLineInput, settings: Parameters<typeof priceMetalsLine>[1] = null) =>
  priceMetalsLine(l, settings, CATALOG).breaks[0]?.unitPrice ?? Number.NaN;

test('the engine raises the price when OSP is present', () => {
  assert.ok(priceOf({ ...base, outsideProcessing: [req()] }) > priceOf(base));
});

test('OSP passes through at its marked-up cost: no second markup, no overhead, no margin', () => {
  // $10 at cost with markup and freight at 0 adds exactly $10.
  const settings = { ospMarkupPct: 0, ospFreightPct: 0 };
  const delta = priceOf({ ...base, outsideProcessing: [req({ unitPrice: 10 })] }, settings) - priceOf(base, settings);
  close(delta, 10, 6);
  // With default rates the line carries exactly the request's marked-up cost.
  const withDefault = priceMetalsLine({ ...base, outsideProcessing: [req()] }, null, CATALOG).breaks[0];
  close(withDefault?.perPart.osp ?? Number.NaN, 2.664, 3);
});

test('prices unchanged when no OSP is attached, and warns about unpriced requests', () => {
  close(priceOf({ ...base, outsideProcessing: [] }), priceOf(base), 10);
  const r = priceMetalsLine({ ...base, outsideProcessing: [req({ status: 'sent', unitPrice: null })] }, null, CATALOG);
  close(r.breaks[0]?.unitPrice ?? Number.NaN, priceOf(base), 10);
  assert.ok(r.warnings.some((w) => /not priced by Procurement/.test(w)));
});
