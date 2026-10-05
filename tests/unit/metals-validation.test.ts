// Validation messages and the "no fabricated inputs" rule for BOM-imported lines.
// Ported from SnapQuote 0626 src/utils/__tests__/metalsBomImportNoFabricatedInputs.test.ts and
// the validator-facing cases of metalsValidationSteps.test.ts (the editor step map is UI).
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
const TIERS = [
  { label: 'Low', assemblies: 100 },
  { label: 'High', assemblies: 1000 },
];

/** What a BOM import produces: identity only; no price, cycle time or geometry. */
function lineAsImportedFromBom(): MetalsLineInput {
  return {
    partNumber: '47729',
    description: 'Outer assembly',
    quantityBreaks: TIERS,
    material: { name: 'Al 6061-T6', stockForm: 'Sheet' },
    operations: [],
    overrides: { laborRatePerHour: 30 },
  };
}

test('BOM import: a freshly imported line is flagged incomplete, naming each missing input', () => {
  const errors = validateMetalsLine(lineAsImportedFromBom(), CATALOG);
  assert.notEqual(errors.length, 0);
  const joined = errors.join(' | ');
  assert.match(joined, /sheet price|raw material/i);
  assert.match(joined, /at least one operation/i);
  assert.match(joined, /weight per unit or geometric dimensions/i);
});

test('BOM import: contributes no material, labor or other cost, and prices at exactly zero', () => {
  const r = priceMetalsLine(lineAsImportedFromBom(), null, CATALOG);
  assert.equal(r.breaks.length, 2);
  for (const b of r.breaks) {
    assert.equal(b.materialKgPerPart, 0);
    assert.equal(b.perPart.material, 0);
    assert.equal(b.perPart.labor, 0);
    assert.equal(b.perPart.qaLabor, 0);
    assert.equal(b.perPart.packagingLabor, 0);
    assert.equal(b.unitPrice, 0);
  }
  assert.ok(r.warnings.some((w) => /priced at \$0/.test(w)));
});

test('BOM import: passes validation once real inputs are entered', () => {
  const priced: MetalsLineInput = {
    ...lineAsImportedFromBom(),
    blank: { thicknessMm: 2, widthMm: 150, lengthMm: 220 },
    material: { name: 'Al 6061-T6', stockForm: 'Sheet', pricePerKg: 4.25 },
    operations: [
      { name: 'Trumpf Tru Laser 2030 Coax', workCell: 'Trumpf Tru Laser 2030 Coax', setupHours: 10 / 60, runMinutesPerPiece: 1.5, ratePerHour: 333 },
    ],
  };
  assert.deepEqual(validateMetalsLine(priced, CATALOG), []);
  for (const b of priceMetalsLine(priced, null, CATALOG).breaks) assert.ok(b.unitPrice > 0);
});

function emptyLine(): MetalsLineInput {
  return { partNumber: '', quantityBreaks: [], material: {}, operations: [] };
}

test('an empty line fails every rule, with the original messages', () => {
  assert.deepEqual(validateMetalsLine(emptyLine(), CATALOG), [
    'Part number is required',
    'Material specification is required',
    'Stock form is required',
    'Material needs a sheet price (from the item number) or a raw material $/kg',
    'At least one operation with setup or run time is required',
    'Either weight per unit or geometric dimensions are required',
  ]);
});

test('negative operation times are reported', () => {
  const errors = validateMetalsLine({ ...emptyLine(), operations: [{ setupHours: -1, runMinutesPerPiece: -1 }] }, CATALOG);
  assert.ok(errors.includes('Operation times cannot be negative'));
});

test('a timed operation without a work cell rate is reported with a count', () => {
  const errors = validateMetalsLine({ ...emptyLine(), operations: [{ name: 'Deburr', setupHours: 0, runMinutesPerPiece: 2 }] }, CATALOG);
  assert.ok(errors.includes('1 operation(s) have time but no work cell — pick a work cell so they are priced'));
});

test('hardware quantity-pricing messages carry the item label', () => {
  const rivet = (priceBreaks: { minQty: number; unitCost: number }[]) => ({
    ...emptyLine(),
    hardware: [{ id: 'r', label: '18-8 POP RIVET', quantity: 1, unitCost: 6.98, priceBreaks }],
  });
  const qty = (l: MetalsLineInput) => validateMetalsLine(l, CATALOG).filter((m) => /^Qty pricing on /.test(m));
  assert.deepEqual(qty(rivet([{ minQty: 0, unitCost: 1.396 }])), [
    'Qty pricing on "18-8 POP RIVET": each tier needs a From-qty of 1 or more',
  ]);
  assert.deepEqual(qty(rivet([{ minQty: 10, unitCost: Number.NaN }])), [
    'Qty pricing on "18-8 POP RIVET": each tier needs a cost of 0 or more',
  ]);
  assert.deepEqual(qty(rivet([{ minQty: 10, unitCost: 1.396 }, { minQty: 10, unitCost: 0.28 }])), [
    'Qty pricing on "18-8 POP RIVET": two tiers start at qty 10',
  ]);
  assert.deepEqual(qty(rivet([{ minQty: 10, unitCost: 1.396 }, { minQty: 50, unitCost: 0.28 }])), []);
});

test('a catalog item number supplies alloy, stock form, thickness and sheet, so the line validates', () => {
  const line: MetalsLineInput = {
    partNumber: 'P-1',
    quantityBreaks: TIERS,
    blank: { lengthMm: 400, widthMm: 300 },
    material: { itemNumber: 'SA0205048096' },
    operations: [{ name: 'Laser', workCell: 'Trumpf Tru Laser 2030 Coax', setupHours: 0.167, runMinutesPerPiece: 1 }],
  };
  assert.deepEqual(validateMetalsLine(line, CATALOG), []);
  const r = priceMetalsLine(line, null, CATALOG);
  assert.equal(r.sheetCosted, true);
  assert.deepEqual(r.warnings, []);
});

test('catalog misses and unpriced items are warnings, not exceptions', () => {
  const unknown = priceMetalsLine(
    { partNumber: 'P', quantityBreaks: TIERS, blank: { lengthMm: 10, widthMm: 10 }, material: { itemNumber: 'NOPE123' }, operations: [{ workCell: 'Not A Machine', setupHours: 1, runMinutesPerPiece: 1 }] },
    null,
    CATALOG,
  );
  assert.ok(unknown.warnings.some((w) => w.includes('"NOPE123" is not in the catalog')));
  assert.ok(unknown.warnings.some((w) => w.includes('work cell "Not A Machine" is not in the catalog')));
  const unpriced = priceMetalsLine(
    { partNumber: 'P', quantityBreaks: TIERS, blank: { lengthMm: 10, widthMm: 10 }, material: { itemNumber: 'SA0225048096' }, operations: [] },
    null,
    CATALOG,
  );
  assert.ok(unpriced.warnings.some((w) => w.includes('has no price') && w.includes('entered by hand')));
  assert.equal(unpriced.sheetCosted, false);
});
