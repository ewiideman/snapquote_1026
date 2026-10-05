// Labor-only (assembly) lines: no material of their own; price = operations + programming
// + hardware (+ OSP). Ported from SnapQuote 0626 src/utils/__tests__/metalsLaborOnly.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  priceMetalsLine,
  validateMetalsLine,
  type MetalsCatalog,
  type MetalsLineInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };
const SCRAP = 0.03;
const PROD_MIN = 55;

function close(actual: number, expected: number, digits: number): void {
  assert.ok(Math.abs(expected - actual) < 10 ** -digits / 2, `expected ${expected}, got ${actual}`);
}

const ASSEMBLY_LINE: MetalsLineInput = {
  partNumber: 'ASM-BOX-SHELF',
  description: 'Assemble box shelf from quoted components',
  laborOnly: true,
  partsPerAssembly: 1,
  quantityBreaks: [
    { label: 'Low', assemblies: 10 },
    { label: 'High', assemblies: 200 },
  ],
  operations: [
    { name: 'Assembly', workCell: 'Assembly', setupHours: 0.333, runMinutesPerPiece: 12, ratePerHour: 70 },
    { name: 'Inspection + Utility', workCell: 'Inspection + Utility', setupHours: 0.25, runMinutesPerPiece: 1, ratePerHour: 70 },
  ],
  hardware: [{ id: 'r', label: '18-8 POP RIVET', quantity: 8, unitCost: 0.28 }],
};

const opCost = (setupHours: number, cycleMin: number, rate: number, qty: number) =>
  (setupHours * rate) / (1 - SCRAP) / qty + ((cycleMin / PROD_MIN) * rate) / (1 - SCRAP);

test('passes validation with no material, sheet, $/kg or geometry at all', () => {
  assert.deepEqual(validateMetalsLine(ASSEMBLY_LINE, CATALOG), []);
});

test('still requires operations: a labor-only line with no labor is an empty line', () => {
  assert.deepEqual(validateMetalsLine({ ...ASSEMBLY_LINE, operations: [] }, CATALOG), [
    'At least one operation with setup or run time is required',
  ]);
});

test('prices as operations + programming + hardware exactly, material $0', () => {
  const r = priceMetalsLine(ASSEMBLY_LINE, null, CATALOG);
  assert.deepEqual(r.warnings, []);
  for (const b of r.breaks) {
    assert.equal(b.perPart.material, 0);
    assert.equal(b.materialKgPerPart, 0);
    assert.equal(b.nesting, null);
    const labor = opCost(0.333, 12, 70, b.parts) + opCost(0.25, 1, 70, b.parts);
    const programming = (2 * 5 * (172 / 60)) / b.parts;
    const hardware = 8 * 0.28 * 1.2;
    close(b.perPart.labor, labor, 6);
    close(b.perPart.programming, programming, 6);
    close(b.perPart.hardware, hardware, 6);
    close(b.unitPrice, labor + programming + hardware, 6);
  }
});

test('ignores material data on the line while laborOnly is set; clearing it restores costing', () => {
  const withStale: MetalsLineInput = {
    ...ASSEMBLY_LINE,
    blank: { lengthMm: 760, widthMm: 71 },
    material: {
      name: 'Al 5052-H32',
      stockForm: 'Sheet',
      sheetPriceUsd: 68.5115,
      sheetLengthMm: 2438.4,
      sheetWidthMm: 1219.2,
      pricePerKg: 5,
    },
  };
  assert.equal(priceMetalsLine(withStale, null, CATALOG).breaks[0]?.perPart.material, 0);
  const off = priceMetalsLine({ ...withStale, laborOnly: false }, null, CATALOG);
  assert.ok((off.breaks[0]?.perPart.material ?? 0) > 0);
});

test("a normal line's validation is unchanged (regression guard)", () => {
  const errors = validateMetalsLine({ ...ASSEMBLY_LINE, laborOnly: undefined }, CATALOG);
  assert.ok(errors.includes('Material specification is required'));
  assert.ok(errors.includes('Material needs a sheet price (from the item number) or a raw material $/kg'));
});
