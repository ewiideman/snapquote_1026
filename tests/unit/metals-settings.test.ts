// Org settings parsing and precedence for the MTL07 knobs.
// Ported from SnapQuote 0626 src/utils/__tests__/metalsCalculationSettings.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_DEFAULTS,
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  effectiveYieldFactor,
  parseMetalsCalculationSettings,
  priceMetalsLine,
  resolveMetalsNumber,
  type MetalsCalculationSettings,
  type MetalsCatalog,
  type MetalsLineInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };

function close(actual: number | undefined, expected: number, digits = 2): void {
  assert.ok(actual !== undefined && Math.abs(expected - actual) < 10 ** -digits / 2, `expected ${expected}, got ${actual}`);
}

test('drops invalid numbers safely', () => {
  const p = parseMetalsCalculationSettings({ targetMarginPct: -0.1, qaMinutesPerUnit: Number.NaN, scrapRecoveryPct: 150 });
  assert.equal(p?.targetMarginPct, undefined);
  assert.equal(p?.qaMinutesPerUnit, undefined);
  assert.equal(p?.scrapRecoveryPct, undefined);
});

test('parses Extrusion and Casting yield factors', () => {
  const p = parseMetalsCalculationSettings({ yieldFactors: { Extrusion: 0.88, Casting: 0.82 } });
  close(p?.yieldFactors?.Extrusion, 0.88);
  close(p?.yieldFactors?.Casting, 0.82);
});

test('parses the MTL07 knobs, snake_case included', () => {
  const p = parseMetalsCalculationSettings({
    materialMarkup: 1.25,
    nest_web_in: 0.2,
    sheetLengthMarginIn: 0.75,
    sheet_width_margin_in: 1.5,
    scrapFactor: 0.05,
    productiveMinutesPerHour: 50,
    engineering_rate_per_hour: 180,
    programMinutesPerWorkCell: 6,
  });
  close(p?.materialMarkup, 1.25);
  close(p?.nestWebIn, 0.2);
  close(p?.sheetLengthMarginIn, 0.75);
  close(p?.sheetWidthMarginIn, 1.5);
  close(p?.scrapFactor, 0.05);
  assert.equal(p?.productiveMinutesPerHour, 50);
  assert.equal(p?.engineeringRatePerHour, 180);
  assert.equal(p?.programMinutesPerWorkCell, 6);
});

test('materialMarkup accepts a multiplier or a bare percentage', () => {
  close(parseMetalsCalculationSettings({ materialMarkup: 1.2 })?.materialMarkup, 1.2);
  close(parseMetalsCalculationSettings({ materialMarkup: 20 })?.materialMarkup, 1.2);
  assert.equal(parseMetalsCalculationSettings({ materialMarkup: -1 })?.materialMarkup, undefined);
});

test('drops out-of-range MTL07 knobs rather than pricing from them', () => {
  const p = parseMetalsCalculationSettings({ productiveMinutesPerHour: 90, scrapFactor: -0.03, nestWebIn: -1 });
  assert.equal(p?.productiveMinutesPerHour, undefined);
  assert.equal(p?.scrapFactor, undefined);
  assert.equal(p?.nestWebIn, undefined);
});

test('merges a nested METALS_DEFAULTS object with top-level keys winning', () => {
  const p = parseMetalsCalculationSettings({ METALS_DEFAULTS: { targetMarginPct: 0.35, qaMinutesPerUnit: 9 }, qaMinutesPerUnit: 1 });
  close(p?.targetMarginPct, 0.35);
  assert.equal(p?.qaMinutesPerUnit, 1);
});

test('null and non-objects parse to null; the empty 031 seed parses to no overrides', () => {
  assert.equal(parseMetalsCalculationSettings(null), null);
  assert.equal(parseMetalsCalculationSettings([1]), null);
  assert.deepEqual(parseMetalsCalculationSettings({}), {});
});

test('line value wins, then settings, then the default', () => {
  assert.equal(resolveMetalsNumber(5, 99, METALS_DEFAULTS.qaMinutesPerUnit), 5);
  assert.equal(resolveMetalsNumber(undefined, 99, METALS_DEFAULTS.qaMinutesPerUnit), 99);
  assert.equal(resolveMetalsNumber(undefined, undefined, METALS_DEFAULTS.qaMinutesPerUnit), METALS_DEFAULTS.qaMinutesPerUnit);
});

test('line yield wins over settings yield factors', () => {
  const settings: MetalsCalculationSettings = { yieldFactors: { Sheet: 0.7 } };
  assert.equal(effectiveYieldFactor('Sheet', 0.75, settings), 0.75);
  assert.equal(effectiveYieldFactor('Sheet', undefined, settings), 0.7);
});

const LOW = [{ label: 'Low', assemblies: 100 }];
const minimalLine = (): MetalsLineInput => ({
  partNumber: 'P1',
  description: 'Test',
  quantityBreaks: LOW,
  blank: { weightPerPartKg: 1 },
  material: { name: 'Al 6061-T6', stockForm: 'Sheet', pricePerKg: 5 },
  operations: [{ name: 'Laser', setupHours: 10 / 60, runMinutesPerPiece: 2, ratePerHour: 150 }],
});
const first = (settings: MetalsCalculationSettings | null) => {
  const b = priceMetalsLine(minimalLine(), settings, CATALOG).breaks[0];
  assert.ok(b);
  return b;
};

test('there is no margin layer: targetMarginPct does not move the price', () => {
  assert.equal(first({ targetMarginPct: 0.4 }).unitPrice, first(null).unitPrice);
});

test('scrapFactor moves labor cost; 3% is the fallback', () => {
  close(first({ scrapFactor: 0.1 }).perPart.labor, (first(null).perPart.labor * (1 - 0.03)) / (1 - 0.1), 10);
});

test('productiveMinutesPerHour moves run cost; 55 is the fallback', () => {
  assert.ok(first({ productiveMinutesPerHour: 60 }).perPart.labor < first(null).perPart.labor);
});

test('engineeringRatePerHour moves programming cost', () => {
  close(first({ engineeringRatePerHour: 344 }).perPart.programming, first(null).perPart.programming * 2, 10);
});
