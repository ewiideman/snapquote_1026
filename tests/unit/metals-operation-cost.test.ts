// Operation cost, Mack MTL07 per-operation formula: one fully loaded cell rate per operation,
// a 55-minute productive hour, a 3% scrap factor, setup / partsPerAssembly amortized over parts.
// Ported from SnapQuote 0626 src/utils/__tests__/metalsOperationCostSplit.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  priceMetalsLine,
  type MetalsCatalog,
  type MetalsLineInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };
const SCRAP = 0.03;
const PROD_MIN = 55;
const LOW = [{ label: 'Low', assemblies: 100 }];

function close(actual: number, expected: number, digits: number): void {
  assert.ok(Math.abs(expected - actual) < 10 ** -digits / 2, `expected ${expected}, got ${actual}`);
}

// qty is in assemblies; setup is / perAsm, then amortized over parts (qty x perAsm).
const opCost = (setupMin: number, cycleMin: number, rate: number, qty: number, perAsm = 1) =>
  ((setupMin / 60 / perAsm) * rate) / (1 - SCRAP) / (qty * perAsm) + ((cycleMin / PROD_MIN) * rate) / (1 - SCRAP);

function line(over: Partial<MetalsLineInput> = {}): MetalsLineInput {
  return {
    partNumber: 'P-1',
    quantityBreaks: LOW,
    blank: { lengthMm: 220, widthMm: 150, thicknessMm: 1.27 },
    material: { name: 'Al 5052-H32', stockForm: 'Sheet', densityKgPerM3: 2680, pricePerKg: 5 },
    operations: [
      { name: 'Trumpf Tru Laser 2030 Coax', workCell: 'Trumpf Tru Laser 2030 Coax', setupHours: 1, runMinutesPerPiece: 1, ratePerHour: 300 },
    ],
    overrides: { laborRatePerHour: 60 },
    ...over,
  };
}

const first = (l: MetalsLineInput) => {
  const b = priceMetalsLine(l, null, CATALOG).breaks[0];
  assert.ok(b);
  return b;
};

test('charges one fully loaded cell rate per operation; the line labor rate is inert', () => {
  const calc = first(line());
  close(calc.perPart.labor, opCost(60, 1, 300, 100), 6);
  const same = first(line({ overrides: { laborRatePerHour: 600 } }));
  close(same.perPart.labor, calc.perPart.labor, 10);
});

test('uses a 55-minute productive hour and a 3% scrap factor', () => {
  const calc = first(line({ operations: [{ name: 'Laser', setupHours: 0, runMinutesPerPiece: 55, ratePerHour: 100 }] }));
  close(calc.perPart.labor, 100 / (1 - SCRAP), 6);
});

test('spreads setup over the run, so a bigger break costs less per part', () => {
  const [low, high] = priceMetalsLine(
    line({ quantityBreaks: [{ label: 'Low', assemblies: 10 }, { label: 'High', assemblies: 1000 }] }),
    null,
    CATALOG,
  ).breaks;
  assert.ok(low && high);
  assert.ok(low.perPart.labor > high.perPart.labor);
  close(low.perPart.labor, opCost(60, 1, 300, 10), 6);
  close(high.perPart.labor, opCost(60, 1, 300, 1000), 6);
});

test('divides setup by parts per assembly before amortizing (Mack I4)', () => {
  close(first(line({ partsPerAssembly: 4 })).perPart.labor, opCost(60, 1, 300, 100, 4), 6);
});

test('an operation with no work cell rate costs nothing (no inherited rate) and is reported', () => {
  const r = priceMetalsLine(line({ operations: [{ name: 'Deburr by hand', setupHours: 0, runMinutesPerPiece: 2 }] }), null, CATALOG);
  assert.equal(r.breaks[0]?.perPart.labor, 0);
  assert.ok(r.warnings.includes('1 operation(s) have time but no work cell — pick a work cell so they are priced'));
});

test('a catalog work cell supplies its Rev F rate when no rate is given', () => {
  const calc = first(line({ operations: [{ name: 'Brake', workCell: 'Trumpf V85 CNC Press Brake', setupHours: 0.25, runMinutesPerPiece: 0.5 }] }));
  close(calc.perPart.labor, opCost(15, 0.5, 123, 100), 6);
  assert.equal(calc.operations[0]?.ratePerHour, 123);
});

test('adds up across several operations', () => {
  const calc = first(
    line({
      operations: [
        { name: 'Laser', setupHours: 0, runMinutesPerPiece: 1, ratePerHour: 300 },
        { name: 'Brake', setupHours: 0, runMinutesPerPiece: 2, ratePerHour: 120 },
      ],
    }),
  );
  close(calc.perPart.labor, opCost(0, 1, 300, 100) + opCost(0, 2, 120, 100), 6);
  assert.equal(calc.operations.length, 2);
});

test('costs nothing when there are no operations', () => {
  const calc = first(line({ operations: [] }));
  assert.equal(calc.perPart.labor, 0);
  assert.equal(calc.perPart.programming, 0);
});

test('charges programming per work cell, amortized over the break', () => {
  const calc = first(
    line({
      operations: [
        { name: 'Laser', setupHours: 0, runMinutesPerPiece: 1, ratePerHour: 300 },
        { name: 'Brake', setupHours: 0, runMinutesPerPiece: 2, ratePerHour: 120 },
      ],
    }),
  );
  close(calc.perPart.programming, (2 * 5 * (172 / 60)) / 100, 6);
});
