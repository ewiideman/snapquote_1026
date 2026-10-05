// Ground truth: the engine must reproduce Mack's own MTL07 pricing.
// Every expected number is from Mack's RFQ workbook RFQ_Locus_Origin_021626.xlsx, as pinned
// in SnapQuote 0626 src/utils/__tests__/metalsMackModel.test.ts. Do not change the expected
// values to make a test pass; fix the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  computeSheetUsage,
  priceMetalsLine,
  resolveNestingParams,
  type MetalsCatalog,
  type MetalsLineInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };
const IN = 25.4;
const DEFAULT_NESTING = resolveNestingParams(undefined, null);

/** Jest toBeCloseTo semantics: |expected - actual| < 10^-digits / 2. */
function close(actual: number, expected: number, digits: number, msg?: string): void {
  assert.ok(
    Math.abs(expected - actual) < 10 ** -digits / 2,
    `${msg ?? ''} expected ${expected}, got ${actual} (to ${digits} dp)`,
  );
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  assert.ok(v !== undefined, `missing index ${i}`);
  return v;
}

const breaks = (qs: number[]) => qs.map((assemblies, i) => ({ label: `Break ${i + 1}`, assemblies }));

// Sheet "37-000542-00" (SIDE PANEL SUPPORT, LONG, BOX SHELF, ORIGIN II). I4 = 4 per assembly;
// SA0205948096 at L10 = 68.5115; part 760 x 71 mm; breaks in ASSEMBLIES 5..1000 (20..4000 parts).
const LOCUS_542: MetalsLineInput = {
  partNumber: '37-000542-00',
  description: 'SIDE PANEL SUPPORT, LONG, BOX SHELF, ORIGIN II',
  partsPerAssembly: 4,
  quantityBreaks: breaks([5, 10, 50, 100, 250, 400, 1000]),
  blank: { lengthMm: 760, widthMm: 71, thicknessMm: 1.5 },
  material: {
    itemNumber: 'SA0205948096',
    name: 'Al 5052-H32',
    stockForm: 'Sheet',
    densityKgPerM3: 2680,
    sheetPriceUsd: 68.5115,
    sheetLengthMm: 96 * IN,
    sheetWidthMm: 48 * IN,
    pricePerKg: 5,
  },
  operations: [
    { name: 'Trumpf TC500R Punch', workCell: 'Trumpf TC500R Punch', setupHours: 0.333, runMinutesPerPiece: 1.0, ratePerHour: 252 },
    { name: 'Timesaver 3121', workCell: 'Timesaver 3121', setupHours: 0.167, runMinutesPerPiece: 0.25, ratePerHour: 70 },
    { name: 'Trumpf V85 CNC Press Brake', workCell: 'Trumpf V85 CNC Press Brake', setupHours: 0.25, runMinutesPerPiece: 0.501, ratePerHour: 123 },
    { name: 'Inspection + Utility', workCell: 'Inspection + Utility', setupHours: 0.25, runMinutesPerPiece: 0.167, ratePerHour: 70 },
  ],
};

const MACK_542_TOTAL = [12.9732, 10.6129, 8.7248, 8.4887, 8.3471, 8.3117, 8.2763];
const MACK_542_LABOR = [8.2796, 7.3526, 6.6111, 6.5184, 6.4628, 6.4489, 6.435];
const MACK_542_PROGRAMMING = [2.8667, 1.4333, 0.2867, 0.1433, 0.0573, 0.0358, 0.0143];
const MACK_542_MATERIAL = 1.827;

test('Locus 542: nests exactly as Mack (J10=3, K10=15, 45 per sheet)', () => {
  const sheet = { priceUsd: 68.5115, lengthMm: 96 * IN, widthMm: 48 * IN };
  const u = computeSheetUsage(sheet, { lengthMm: 760, widthMm: 71 }, 20, DEFAULT_NESTING);
  assert.ok(u);
  assert.equal(u.partsAcross, 3);
  assert.equal(u.partsDown, 15);
  assert.equal(u.partsPerSheet, 45);
  close(u.materialCostPerPart, MACK_542_MATERIAL, 3);
});

test('Locus 542: material is the same fraction of a sheet at every break', () => {
  const r = priceMetalsLine(LOCUS_542, null, CATALOG);
  assert.equal(r.breaks.length, 7);
  for (const b of r.breaks) close(b.perPart.material, MACK_542_MATERIAL, 3);
});

test("Locus 542: labor per break matches Mack's Labor Total Cost (S37:Y37)", () => {
  const r = priceMetalsLine(LOCUS_542, null, CATALOG);
  r.breaks.forEach((b, i) => close(b.perPart.labor, at(MACK_542_LABOR, i), 3, b.label));
});

test("Locus 542: programming per break matches Mack's Programming/NRE (S36:Y36)", () => {
  const r = priceMetalsLine(LOCUS_542, null, CATALOG);
  r.breaks.forEach((b, i) => close(b.perPart.programming, at(MACK_542_PROGRAMMING, i), 3, b.label));
});

test("Locus 542: total part cost matches Mack's sheet at all seven breaks (S39:Y39)", () => {
  const r = priceMetalsLine(LOCUS_542, null, CATALOG);
  r.breaks.forEach((b, i) => close(b.unitPrice, at(MACK_542_TOTAL, i), 3, b.label));
});

test('Locus 542: no overhead and no margin; price equals cost', () => {
  const r = priceMetalsLine(LOCUS_542, null, CATALOG);
  for (const b of r.breaks) {
    assert.equal(b.perPart.overhead, 0);
    assert.equal(b.perPart.margin, 0);
    close(b.unitPrice, b.unitCost, 10);
  }
});

test("Chris's 1 x 1.5 in example prices at pennies, not dollars, at low quantity", () => {
  const sheet = { priceUsd: 46.6, lengthMm: 96 * IN, widthMm: 48 * IN };
  const u = computeSheetUsage(sheet, { lengthMm: 1.5 * IN, widthMm: 1.0 * IN }, 3, DEFAULT_NESTING);
  assert.ok(u);
  assert.equal(u.partsAcross, 57);
  assert.equal(u.partsDown, 40);
  close(u.materialCostPerPart, (46.6 / 2280) * 1.2, 4);
  assert.ok(u.materialCostPerPart < 0.05);
});

test('breaks are ASSEMBLIES: parts = assemblies x partsPerAssembly, extended over parts', () => {
  const r = priceMetalsLine(LOCUS_542, null, CATALOG);
  r.breaks.forEach((b, i) => {
    const q = at(LOCUS_542.quantityBreaks, i).assemblies;
    assert.equal(b.assemblies, q);
    assert.equal(b.parts, q * 4);
    close(b.extendedPrice, b.unitPrice * b.parts, 10);
  });
});

test('setup is divided by partsPerAssembly, then amortized over PARTS (Mack J50 to L50)', () => {
  const r = priceMetalsLine({ ...LOCUS_542, quantityBreaks: breaks([5]) }, null, CATALOG);
  const b = at(r.breaks, 0);
  const scrap = 0.03;
  const parts = 20;
  const perAsm = 4;
  const setupShare = (0.333 * 252 + 0.167 * 70 + 0.25 * 123 + 0.25 * 70) / (1 - scrap) / perAsm / parts;
  const runShare = (1.0 * 252 + 0.25 * 70 + 0.501 * 123 + 0.167 * 70) / 55 / (1 - scrap);
  close(b.perPart.labor, setupShare + runShare, 6);
});

// Sheet "37-001746-00" (WEDGE, TIE DOWN, FLEX SHELF, ORIGIN 2): qty-per 1, SC0104748096 at 46.60,
// 3.675 x 1.875 in, five operations, a tiered rivet (6.98 / 1.396 at 10+ / 0.28 at 50+) and a
// 1.89 lanyard, both marked up x1.2 like Mack's rows 19-29.
const WEDGE: MetalsLineInput = {
  partNumber: '37-001746-00',
  description: 'WEDGE, TIE DOWN, FLEX SHELF, ORIGIN 2',
  partsPerAssembly: 1,
  quantityBreaks: breaks([5, 10, 50, 100, 250, 400, 1000]),
  blank: { lengthMm: 3.675 * IN, widthMm: 1.875 * IN, thicknessMm: 1.19 },
  material: {
    itemNumber: 'SC0104748096',
    name: 'CRS',
    stockForm: 'Sheet',
    densityKgPerM3: 7870,
    sheetPriceUsd: 46.6,
    sheetLengthMm: 96 * IN,
    sheetWidthMm: 48 * IN,
    pricePerKg: 2,
  },
  operations: [
    { name: 'Trumpf Tru Laser 2030 Fiber L72', workCell: 'Trumpf Tru Laser 2030 Fiber L72', setupHours: 0.167, runMinutesPerPiece: 1.0, ratePerHour: 355 },
    { name: 'Manual Deburring', workCell: 'Manual Deburring', setupHours: 0.167, runMinutesPerPiece: 0.5, ratePerHour: 70 },
    { name: 'Trumpf V85 CNC Press Brake', workCell: 'Trumpf V85 CNC Press Brake', setupHours: 0.25, runMinutesPerPiece: 0.668, ratePerHour: 123 },
    { name: 'Riveting', workCell: 'Riveting', setupHours: 0.167, runMinutesPerPiece: 0.167, ratePerHour: 70 },
    { name: 'Inspection + Utility', workCell: 'Inspection + Utility', setupHours: 0.25, runMinutesPerPiece: 0.5, ratePerHour: 70 },
  ],
  hardware: [
    {
      id: 'rivet',
      label: '18-8 POP RIVET 97525A485',
      quantity: 1,
      unitCost: 6.98,
      priceBreaks: [
        { minQty: 10, unitCost: 1.396 },
        { minQty: 50, unitCost: 0.28 },
      ],
    },
    { id: 'lanyard', label: 'STEEL LANYARD 90312A609', quantity: 1, unitCost: 1.89 },
  ],
};
const MACK_WEDGE_TOTAL = [61.8015, 34.4376, 16.568, 14.5017, 13.2619, 12.952, 12.642];
const MACK_WEDGE_LABOR = [36.7183, 23.2219, 12.4248, 11.0751, 10.2653, 10.0629, 9.8604];
const MACK_WEDGE_PROG = [14.3333, 7.1667, 1.4333, 0.7167, 0.2867, 0.1792, 0.0717];

test('Wedge: nests 24 x 22 = 528 per sheet and prices sheet material at $0.106', () => {
  const sheet = { priceUsd: 46.6, lengthMm: 96 * IN, widthMm: 48 * IN };
  const u = computeSheetUsage(sheet, { lengthMm: 3.675 * IN, widthMm: 1.875 * IN }, 5, DEFAULT_NESTING);
  assert.ok(u);
  assert.equal(u.partsAcross, 24);
  assert.equal(u.partsDown, 22);
  close(u.materialCostPerPart, (46.6 / 528) * 1.2, 4);
});

test('Wedge: purchased hardware carries the material markup, at its quantity tier', () => {
  const at50 = at(priceMetalsLine({ ...WEDGE, quantityBreaks: breaks([50]) }, null, CATALOG).breaks, 0);
  close(at50.perPart.hardware, (0.28 + 1.89) * 1.2, 6);
  const at5 = at(priceMetalsLine({ ...WEDGE, quantityBreaks: breaks([5]) }, null, CATALOG).breaks, 0);
  close(at5.perPart.hardware, (6.98 + 1.89) * 1.2, 6);
});

test('Wedge: labor and programming match Mack at every break', () => {
  const r = priceMetalsLine(WEDGE, null, CATALOG);
  r.breaks.forEach((b, i) => {
    close(b.perPart.labor, at(MACK_WEDGE_LABOR, i), 3, b.label);
    close(b.perPart.programming, at(MACK_WEDGE_PROG, i), 3, b.label);
  });
});

test('Wedge: total matches Mack at all seven breaks (tiered rivet price)', () => {
  const r = priceMetalsLine(WEDGE, null, CATALOG);
  r.breaks.forEach((b, i) => close(b.unitPrice, at(MACK_WEDGE_TOTAL, i), 3, b.label));
});

test('ground-truth lines price without warnings', () => {
  assert.deepEqual(priceMetalsLine(LOCUS_542, null, CATALOG).warnings, []);
  assert.deepEqual(priceMetalsLine(WEDGE, null, CATALOG).warnings, []);
});
