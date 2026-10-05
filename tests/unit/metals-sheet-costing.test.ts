// Sheet material costing (Mack MTL07 nesting). Ported from SnapQuote 0626
// src/utils/__tests__/metalsSheetCosting.test.ts, plus the August 2026 material-cost fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  computeSheetUsage,
  findMetalsMaterialItem,
  isSheetCosted,
  metalsItemSheetSpec,
  priceMetalsLine,
  resolveNestingParams,
  type MetalsCatalog,
  type MetalsLineInput,
  type MetalsSheetInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };
const IN = 25.4;
const NEST = resolveNestingParams(undefined, null);

function close(actual: number, expected: number, digits: number, msg?: string): void {
  assert.ok(
    Math.abs(expected - actual) < 10 ** -digits / 2,
    `${msg ?? ''} expected ${expected}, got ${actual} (to ${digits} dp)`,
  );
}

// SA0205048096: 5052-H32, .050", 48 x 96 in.
const ITEM = 'SA0205048096';
const SPEC = metalsItemSheetSpec(findMetalsMaterialItem(CATALOG, ITEM));
assert.ok(SPEC);
const SHEET: MetalsSheetInput = { priceUsd: SPEC.priceUsd, lengthMm: SPEC.lengthMm, widthMm: SPEC.widthMm };

function lineFromItem(over: Partial<MetalsLineInput> = {}): MetalsLineInput {
  return {
    partNumber: 'P-1',
    quantityBreaks: [{ label: 'Low', assemblies: 100 }],
    blank: { lengthMm: 400, widthMm: 300, thicknessMm: 1.27 },
    material: { itemNumber: ITEM, name: 'Al 5052-H32', stockForm: 'Sheet', densityKgPerM3: 2680, pricePerKg: SPEC?.pricePerKg },
    operations: [{ name: 'Laser', setupHours: 10 / 60, runMinutesPerPiece: 1.5, ratePerHour: 333 }],
    ...over,
  };
}

/** No item number behind the line: costing falls back to mass x $/kg. */
function noSheet(): MetalsLineInput {
  return lineFromItem({
    material: { name: 'Al 5052-H32', stockForm: 'Sheet', densityKgPerM3: 2680, pricePerKg: SPEC?.pricePerKg },
  });
}

test('catalog: resolves price, size and a $/kg for a cataloged item', () => {
  assert.ok(SPEC);
  close(SPEC.widthMm, 1219.2, 1);
  close(SPEC.lengthMm, 2438.4, 1);
  assert.ok(SPEC.massKg > 8 && SPEC.massKg < 13);
  assert.ok(SPEC.pricePerKg > 3 && SPEC.pricePerKg < 12);
});

test('catalog: gives no sheet for an item with no purchase price', () => {
  assert.equal(metalsItemSheetSpec(findMetalsMaterialItem(CATALOG, 'SCX1#1648096')), undefined);
});

// Part 300 x 400 mm = 11.9 x 15.8 in after rounding up; usable 95.5 x 47, web 0.15:
// across = floor(95.5 / 15.95) = 5, down = floor(47 / 12.05) = 3, so 15 per sheet.
test('nests parts across x down on the usable sheet', () => {
  const u = computeSheetUsage(SHEET, { lengthMm: 400, widthMm: 300 }, 100, NEST);
  assert.ok(u);
  assert.equal(u.partsAcross, 5);
  assert.equal(u.partsDown, 3);
  assert.equal(u.partsPerSheet, 15);
  assert.equal(u.sheetsUsed, Math.ceil(100 / 15));
});

test('charges each part its fraction of a sheet times the material markup', () => {
  const u = computeSheetUsage(SHEET, { lengthMm: 400, widthMm: 300 }, 1, NEST);
  assert.ok(u);
  close(u.materialCostPerPart, ((SHEET.priceUsd ?? 0) / 15) * 1.2, 6);
});

test('material per part does not depend on quantity (no whole-sheet rounding)', () => {
  const part = { lengthMm: 400, widthMm: 300 };
  const at1 = computeSheetUsage(SHEET, part, 1, NEST)?.materialCostPerPart ?? Number.NaN;
  const at100 = computeSheetUsage(SHEET, part, 100, NEST)?.materialCostPerPart ?? Number.NaN;
  const at5000 = computeSheetUsage(SHEET, part, 5000, NEST)?.materialCostPerPart ?? Number.NaN;
  close(at1, at100, 10);
  close(at100, at5000, 10);
});

test('returns nothing when the part does not fit on the sheet', () => {
  assert.equal(computeSheetUsage(SHEET, { lengthMm: 3000, widthMm: 2000 }, 100, NEST), undefined);
});

test('returns nothing without a sheet, so costing falls back to mass', () => {
  assert.equal(computeSheetUsage({}, { lengthMm: 400, widthMm: 300 }, 100, NEST), undefined);
});

test('isSheetCosted: true when a purchased sheet is behind the line and the part fits', () => {
  assert.equal(isSheetCosted(lineFromItem(), null, CATALOG), true);
});

test('isSheetCosted: false with no sheet behind the line', () => {
  assert.equal(isSheetCosted(noSheet(), null, CATALOG), false);
});

test('isSheetCosted: false when the part does not fit (falls back to mass)', () => {
  const tooBig = lineFromItem({ blank: { lengthMm: 3000, widthMm: 2000, thicknessMm: 1.27 } });
  assert.equal(isSheetCosted(tooBig, null, CATALOG), false);
  const r = priceMetalsLine(tooBig, null, CATALOG);
  assert.ok(r.warnings.some((w) => /does not fit/.test(w)));
});

const TIERS = [
  { label: 'Proto', assemblies: 1 },
  { label: 'Low', assemblies: 100 },
  { label: 'High', assemblies: 5000 },
];

test('engine reports parts per sheet and sheets used on every break', () => {
  const r = priceMetalsLine(lineFromItem({ quantityBreaks: TIERS }), null, CATALOG);
  for (const b of r.breaks) {
    assert.equal(b.nesting?.partsPerSheet, 15);
    assert.equal(b.nesting?.sheetsUsed, Math.ceil(b.parts / 15));
  }
});

test('engine charges the same material per part on a prototype as on a production run', () => {
  const [proto, low, high] = priceMetalsLine(lineFromItem({ quantityBreaks: TIERS }), null, CATALOG).breaks;
  assert.ok(proto && low && high);
  close(proto.perPart.material, low.perPart.material, 10);
  close(low.perPart.material, high.perPart.material, 10);
  assert.ok(proto.unitPrice > high.unitPrice);
});

test('engine falls back to mass costing on a line with no sheet behind it', () => {
  const r = priceMetalsLine({ ...noSheet(), quantityBreaks: TIERS }, null, CATALOG);
  assert.equal(r.sheetCosted, false);
  for (const b of r.breaks) {
    assert.equal(b.nesting, null);
    assert.ok(b.perPart.material > 0);
  }
  const [proto, , high] = r.breaks;
  assert.ok(proto && high);
  close(proto.perPart.material, high.perPart.material, 10);
});

// August 2026 fix (SnapQuote 0626 docs/sessions/SESSION_2026-08-11.md): Mack reported a
// 1 x 1.5 in part at $13.00 material against $0.40 on their legacy system, because SnapQuote
// charged whole sheets rounded up across the run. The session notes do not record the sheet
// price or order quantity behind $13.00 / $0.40, so those two figures cannot be reproduced;
// the worked example the notes do give ($46.60 sheet, 3.7 x 1.9 in part) can.
test('August 2026 fix: material is a fraction of a sheet, not whole sheets for the run', () => {
  const sheet = { priceUsd: 46.6, lengthMm: 96 * IN, widthMm: 48 * IN };
  const tiny = { lengthMm: 1.5 * IN, widthMm: 1.0 * IN };
  const u = computeSheetUsage(sheet, tiny, 3, NEST);
  assert.ok(u);
  assert.equal(u.sheetsUsed, 1);
  const fractional = u.materialCostPerPart;
  const wholeSheet = (u.sheetsUsed * 46.6 * 1.2) / 3;
  close(fractional, (46.6 / (57 * 40)) * 1.2, 6);
  assert.ok(fractional < 0.05, `pennies, got ${fractional}`);
  assert.ok(wholeSheet > 13, `whole-sheet charging was dollars, got ${wholeSheet}`);
  for (const qty of [1, 3, 1000, 100000]) {
    close(computeSheetUsage(sheet, tiny, qty, NEST)?.materialCostPerPart ?? Number.NaN, fractional, 12);
  }
});

test("August 2026 fix: Mack's worked example, $46.60 sheet and a 3.7 x 1.9 in part", () => {
  const sheet = { priceUsd: 46.6, lengthMm: 96 * IN, widthMm: 48 * IN };
  const part = { lengthMm: 3.7 * IN, widthMm: 1.9 * IN };
  // Aug 11 grid nest: 0.5 in edge margin on both axes, 0.15 in kerf: 24 x 23 = 552 per sheet,
  // $0.0844 at cost (the notes' "$0.09" after rounding up to the penny).
  const aug11 = computeSheetUsage(sheet, part, 1, resolveNestingParams({ sheetLengthMarginIn: 0.5, sheetWidthMarginIn: 0.5 }, { materialMarkup: 1 }));
  assert.ok(aug11);
  assert.equal(aug11.partsPerSheet, 552);
  assert.equal(Math.ceil(aug11.materialCostPerPart * 100) / 100, 0.09);
  // MTL07 (0.5 in length, 1.0 in width margin, x1.2 markup): 24 x 22 = 528, $0.106,
  // the "$0.11" on Mack's legacy sheet.
  const mtl07 = computeSheetUsage(sheet, part, 1, NEST);
  assert.ok(mtl07);
  assert.equal(mtl07.partsPerSheet, 528);
  close(mtl07.materialCostPerPart, 0.11, 2);
});
