// Seed data: material catalog (migration 046) and MTL07 Rev F work cells (migration 047).
// Ported from SnapQuote 0626 src/utils/__tests__/metalsMaterialCatalog.test.ts and
// metalsFacilityRates.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_PRICE_WINDOW,
  METALS_WORK_CELLS,
  deriveMetalsItemAttributes,
  findMetalsMaterialItem,
  findMetalsWorkCell,
  metalsItemPriceNote,
  workCellSetupMinutes,
  type MetalsCatalog,
  type MetalsWorkCell,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };

function cell(name: string): MetalsWorkCell {
  const c = findMetalsWorkCell(CATALOG, name);
  assert.ok(c, `work cell ${name}`);
  return c;
}

test('material catalog: 71 items with unique item numbers', () => {
  assert.equal(METALS_MATERIAL_ITEMS.length, 71);
  assert.equal(new Set(METALS_MATERIAL_ITEMS.map((i) => i.itemNumber)).size, 71);
});

test('material catalog: never a price without a basis, or a basis without a price', () => {
  for (const item of METALS_MATERIAL_ITEMS) {
    if (item.priceUsd === null) {
      assert.equal(item.priceBasis, 'none');
      assert.equal(item.purchaseCount, 0);
    } else {
      assert.notEqual(item.priceBasis, 'none');
      assert.ok(item.priceUsd > 0);
      assert.ok(item.purchaseCount > 0);
      assert.ok(item.lastPurchaseDate);
    }
  }
});

test('material catalog: items nobody purchased stay unpriced', () => {
  const unpriced = METALS_MATERIAL_ITEMS.filter((i) => i.priceUsd === null);
  assert.equal(unpriced.length, 25);
  for (const item of unpriced) assert.match(metalsItemPriceNote(item), /entered by hand/i);
});

test('material catalog: says which window each price came from', () => {
  const six = METALS_MATERIAL_ITEMS.filter((i) => i.priceBasis === 'sixMonthAverage');
  const fallback = METALS_MATERIAL_ITEMS.filter((i) => i.priceBasis === 'twelveMonthAverage');
  assert.equal(six.length, 33);
  assert.equal(fallback.length, 13);
  const [s0] = six;
  const [f0] = fallback;
  assert.ok(s0 && f0);
  assert.ok(metalsItemPriceNote(s0).includes(METALS_PRICE_WINDOW.start));
  assert.ok(metalsItemPriceNote(s0).includes(METALS_PRICE_WINDOW.end));
  assert.match(metalsItemPriceNote(f0), /no purchase in the last six months/i);
});

test('material catalog: resolves item numbers case-insensitively and rejects unknown ones', () => {
  assert.equal(findMetalsMaterialItem(CATALOG, 'sa0205048096')?.itemNumber, 'SA0205048096');
  assert.equal(findMetalsMaterialItem(CATALOG, ' SA0205048096 ')?.itemNumber, 'SA0205048096');
  assert.equal(findMetalsMaterialItem(CATALOG, 'NOT-A-PART'), undefined);
});

test('material catalog: decodes stock attributes from the item number', () => {
  const attrs = deriveMetalsItemAttributes('SA0205048096', 'SHEET, 5052-H32 ALU.050" 48X96');
  assert.ok(attrs);
  assert.ok(Math.abs(attrs.thicknessMm - 1.27) < 0.005);
  assert.equal(attrs.densityKgPerM3, 2680);
  assert.equal(deriveMetalsItemAttributes('SCX1#1648096', 'EXPANDED STEEL'), undefined);
});

test('material catalog: prices stainless from recent actuals, not the old long-run average', () => {
  const ss = findMetalsMaterialItem(CATALOG, 'SS0102048096');
  assert.ok(ss?.priceUsd !== null && ss?.priceUsd !== undefined);
  assert.ok(ss.priceUsd < 80);
});

test('work cells: all 31 with unique names', () => {
  assert.equal(METALS_WORK_CELLS.length, 31);
  assert.equal(new Set(METALS_WORK_CELLS.map((c) => c.name)).size, 31);
});

test('work cells: Set-Up Charge / Min equals the hourly setup charge over 60', () => {
  for (const c of METALS_WORK_CELLS) assert.ok(Math.abs(c.setUpChargePerMin - c.setUpCharge / 60) < 0.005, c.name);
});

test('work cells: setup time converts from fractions of an hour to minutes', () => {
  for (const c of METALS_WORK_CELLS) {
    const m = Math.round(workCellSetupMinutes(c));
    assert.ok(m >= 4 && m <= 60, c.name);
  }
  assert.equal(workCellSetupMinutes(cell('Assembly')), 19.98);
  assert.equal(workCellSetupMinutes(cell('Manual Deburring')), 10.02);
  assert.equal(workCellSetupMinutes(cell('Trumpf TC600L Punch Laser Combo')), 19.98);
});

test('work cells: setup minutes carry no floating-point noise', () => {
  assert.equal(workCellSetupMinutes(cell('Trumpf Tru Laser 2030 Coax')), 10.02);
  for (const c of METALS_WORK_CELLS) {
    const decimals = String(workCellSetupMinutes(c)).replace('-', '').split('.')[1]?.length ?? 0;
    assert.ok(decimals <= 2, c.name);
  }
});

test('work cells: carry the MTL07 Rev F rates Mack quotes with', () => {
  assert.equal(cell('Trumpf TC600L Punch Laser Combo').hourlyCellRate, 334);
  assert.equal(cell('Trumpf TC600L Punch Laser Combo').setUpTimeHours, 0.333);
  assert.equal(cell('Trumpf TC500R Punch').hourlyCellRate, 252);
  assert.equal(cell('Trumpf Tru Laser 2030 Fiber L82').hourlyCellRate, 355);
  assert.equal(cell('Bystronic Xpert 250').hourlyCellRate, 129);
  assert.equal(cell('Trumpf V85 CNC Press Brake').hourlyCellRate, 123);
  assert.equal(cell('Assembly').hourlyCellRate, 70);
  assert.equal(cell('Timesaver 3121').hourlyCellRate, 70);
  assert.equal(cell('TIG Welding').hourlyCellRate, 106);
});

test('work cells: unknown names return undefined rather than a default', () => {
  assert.equal(findMetalsWorkCell(CATALOG, 'Not A Machine'), undefined);
  assert.equal(findMetalsWorkCell(CATALOG, ''), undefined);
  assert.equal(findMetalsWorkCell(CATALOG, null), undefined);
  assert.equal(findMetalsWorkCell(CATALOG, 'Trumpf TC500L Punch Laser Combo'), undefined);
});

test("work cells: reproduce Mack's printed Set-Up Cost column on every row (reference only)", () => {
  const offenders = METALS_WORK_CELLS.filter(
    (c) => Math.abs(c.setUpChargePerMin * c.setUpTimeHours - c.setUpCostAsPrinted) > 0.006,
  ).map((c) => c.name);
  assert.deepEqual(offenders, []);
});
