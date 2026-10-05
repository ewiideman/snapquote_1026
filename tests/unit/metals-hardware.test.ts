// PEM fasteners and other purchased hardware, with per-quantity price tiers.
// Ported from SnapQuote 0626 src/utils/__tests__/metalsPemCost.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  hardwareCostPerPart,
  hardwareUnitCostAtQty,
  priceMetalsLine,
  type MetalsCatalog,
  type MetalsHardwareInput,
  type MetalsLineInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };

function close(actual: number, expected: number, digits: number): void {
  assert.ok(Math.abs(expected - actual) < 10 ** -digits / 2, `expected ${expected}, got ${actual}`);
}

function pem(over: Partial<MetalsHardwareInput> = {}): MetalsHardwareInput {
  return { id: 'p1', label: 'PEM CLS-440-2', quantity: 4, unitCost: 0.12, ...over };
}

test('sums quantity x unit cost over the rows', () => {
  close(hardwareCostPerPart([pem({ quantity: 4, unitCost: 0.12 }), pem({ quantity: 2, unitCost: 0.35 })]), 1.18, 10);
});

test('is zero with no rows or no array', () => {
  assert.equal(hardwareCostPerPart([]), 0);
  assert.equal(hardwareCostPerPart(undefined), 0);
});

test('ignores blank, zero and non-finite rows', () => {
  const rows = [
    pem({ quantity: 0, unitCost: 5 }),
    pem({ quantity: 3, unitCost: 0 }),
    pem({ quantity: Number.NaN, unitCost: 2 }),
    pem({ quantity: 5, unitCost: 0.2 }),
  ];
  close(hardwareCostPerPart(rows), 1.0, 10);
});

// Chris's rivet from the Locus wedge: 6.98 below 10, 1.396 at 10+, 0.28 at 50+.
const rivet = {
  unitCost: 6.98,
  priceBreaks: [
    { minQty: 10, unitCost: 1.396 },
    { minQty: 50, unitCost: 0.28 },
  ],
};

test('picks the highest tier at or below the order quantity', () => {
  assert.equal(hardwareUnitCostAtQty(rivet, 5), 6.98);
  assert.equal(hardwareUnitCostAtQty(rivet, 9), 6.98);
  assert.equal(hardwareUnitCostAtQty(rivet, 10), 1.396);
  assert.equal(hardwareUnitCostAtQty(rivet, 49), 1.396);
  assert.equal(hardwareUnitCostAtQty(rivet, 50), 0.28);
  assert.equal(hardwareUnitCostAtQty(rivet, 4000), 0.28);
});

test('tolerates an unsorted schedule', () => {
  const shuffled = { unitCost: 6.98, priceBreaks: [{ minQty: 50, unitCost: 0.28 }, { minQty: 10, unitCost: 1.396 }] };
  assert.equal(hardwareUnitCostAtQty(shuffled, 25), 1.396);
  assert.equal(hardwareUnitCostAtQty(shuffled, 100), 0.28);
});

test('uses the base cost with no schedule, an empty one, or a bad quantity', () => {
  assert.equal(hardwareUnitCostAtQty({ unitCost: 2 }, 100), 2);
  assert.equal(hardwareUnitCostAtQty({ unitCost: 2, priceBreaks: [] }, 100), 2);
  assert.equal(hardwareUnitCostAtQty(rivet, 0), 6.98);
});

test('ignores malformed tiers rather than pricing from them', () => {
  const messy = {
    unitCost: 2,
    priceBreaks: [
      { minQty: 0, unitCost: 0.01 },
      { minQty: 10, unitCost: Number.NaN },
      { minQty: 20, unitCost: -1 },
      { minQty: 30, unitCost: 0.5 },
    ],
  };
  assert.equal(hardwareUnitCostAtQty(messy, 15), 2);
  assert.equal(hardwareUnitCostAtQty(messy, 30), 0.5);
});

test('a zero-cost tier is honored (free at volume is a real schedule)', () => {
  assert.equal(hardwareUnitCostAtQty({ unitCost: 1, priceBreaks: [{ minQty: 100, unitCost: 0 }] }, 100), 0);
});

test('flows through line cost per order quantity', () => {
  const rows: MetalsHardwareInput[] = [
    { label: 'rivet', quantity: 2, ...rivet },
    { label: 'lanyard', quantity: 1, unitCost: 1.89 },
  ];
  close(hardwareCostPerPart(rows, 5), 2 * 6.98 + 1.89, 10);
  close(hardwareCostPerPart(rows, 50), 2 * 0.28 + 1.89, 10);
  close(hardwareCostPerPart(rows), 2 * 6.98 + 1.89, 10);
});

const base: MetalsLineInput = {
  partNumber: 'P-1',
  quantityBreaks: [{ label: 'Low', assemblies: 100 }],
  blank: { lengthMm: 220, widthMm: 150, thicknessMm: 1.27 },
  material: { name: 'Al 5052-H32', stockForm: 'Sheet', densityKgPerM3: 2680, pricePerKg: 4.25 },
  operations: [{ name: 'Laser', setupHours: 10 / 60, runMinutesPerPiece: 1.5, ratePerHour: 333 }],
};
const first = (l: MetalsLineInput) => {
  const b = priceMetalsLine(l, null, CATALOG).breaks[0];
  assert.ok(b);
  return b;
};

test('the engine reports hardware per part, marked up x1.2', () => {
  close(first({ ...base, hardware: [pem({ quantity: 4, unitCost: 0.25 })] }).perPart.hardware, 1.2, 10);
});

test('hardware raises the price by exactly its marked-up cost: no overhead, no margin', () => {
  const delta = first({ ...base, hardware: [pem({ quantity: 4, unitCost: 0.25 })] }).unitPrice - first(base).unitPrice;
  close(delta, 1.2, 6);
});

test('prices unchanged when no hardware is attached', () => {
  close(first({ ...base, hardware: [] }).unitPrice, first(base).unitPrice, 10);
});

test('malformed price tiers are reported as warnings', () => {
  const r = priceMetalsLine(
    { ...base, hardware: [pem({ label: '18-8 POP RIVET', priceBreaks: [{ minQty: 10, unitCost: 1.396 }, { minQty: 10, unitCost: 0.28 }] })] },
    null,
    CATALOG,
  );
  assert.ok(r.warnings.includes('Qty pricing on "18-8 POP RIVET": two tiers start at qty 10'));
});
