// Itemized tooling, amortized into the part price, and its share for billing it separately.
// Ported from SnapQuote 0626 src/utils/__tests__/metalsToolingSeparateLine.test.ts. The BD
// quote-composition cases there (price overrides, clamping at 0) belong to the composition
// module, not the engine; the engine-side contract (the exact share to strip) is tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  priceMetalsLine,
  toolingShareOfPrice,
  toolingTotal,
  type MetalsCatalog,
  type MetalsLineInput,
  type MetalsToolingInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };
const TIERS = [
  { label: 'Low', assemblies: 100 },
  { label: 'High', assemblies: 1000 },
];

function close(actual: number, expected: number, digits: number): void {
  assert.ok(Math.abs(expected - actual) < 10 ** -digits / 2, `expected ${expected}, got ${actual}`);
}

function lineWithTooling(tooling: MetalsToolingInput | undefined): MetalsLineInput {
  return {
    partNumber: 'P-1',
    description: 'Bracket',
    quantityBreaks: TIERS,
    blank: { lengthMm: 220, widthMm: 150, thicknessMm: 1.27 },
    material: { name: 'Al 5052-H32', stockForm: 'Sheet', densityKgPerM3: 2680, pricePerKg: 4.25 },
    operations: [
      { name: 'Trumpf Tru Laser 2030 Coax', workCell: 'Trumpf Tru Laser 2030 Coax', setupHours: 10 / 60, runMinutesPerPiece: 1.5, ratePerHour: 333 },
    ],
    ...(tooling ? { tooling } : {}),
  };
}

const TWO_ITEMS = [
  { id: 't1', label: 'Press brake die set', amount: 1200 },
  { id: 't2', label: 'Weld fixture', amount: 800 },
];

test('sums the itemized list', () => {
  assert.equal(toolingTotal({ items: TWO_ITEMS }), 2000);
});

test('falls back to the legacy lump sum when there is no list', () => {
  assert.equal(toolingTotal({ lumpSum: 1500 }), 1500);
});

test('treats an empty list as zero rather than resurrecting the lump sum', () => {
  assert.equal(toolingTotal({ items: [], lumpSum: 1500 }), 0);
});

test('amortizes the itemized total into the unit price, as the lump sum did', () => {
  const itemized = priceMetalsLine(lineWithTooling({ items: TWO_ITEMS }), null, CATALOG);
  const lump = priceMetalsLine(lineWithTooling({ lumpSum: 2000 }), null, CATALOG);
  itemized.breaks.forEach((b, i) => {
    close(b.unitPrice, lump.breaks[i]?.unitPrice ?? Number.NaN, 10);
    close(b.perPart.tooling, 2000 / b.parts, 10);
  });
});

test('amortizeOverParts overrides the break quantity', () => {
  const r = priceMetalsLine(lineWithTooling({ items: TWO_ITEMS, amortizeOverParts: 5000 }), null, CATALOG);
  for (const b of r.breaks) close(b.perPart.tooling, 2000 / 5000, 10);
});

test('stripping tooling removes exactly what it contributed, no more, no less', () => {
  const withTooling = priceMetalsLine(lineWithTooling({ items: TWO_ITEMS }), null, CATALOG);
  const without = priceMetalsLine(lineWithTooling(undefined), null, CATALOG);
  withTooling.breaks.forEach((b, i) => {
    const share = toolingShareOfPrice(b);
    assert.ok(share > 0);
    close(b.unitPrice - share, without.breaks[i]?.unitPrice ?? Number.NaN, 10);
    // Under MTL07 there is no margin, so the revenue given up is the tooling cost itself.
    close(share * b.parts, 2000, 8);
  });
});

test('no tooling, no share', () => {
  for (const b of priceMetalsLine(lineWithTooling(undefined), null, CATALOG).breaks) {
    assert.equal(toolingShareOfPrice(b), 0);
  }
});
