import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRates, rateProblem, vendorPrices } from '../../src/quoting/procurement.ts';

test("scrap grosses up, then freight and markup are added (the old SnapQuote's order)", () => {
  // 10 / (1 - 0.05) = 10.5263; × 1.03 = 10.8421; × 1.25 = 13.5526
  assert.equal(applyRates(10, { scrapPct: 5, freightPct: 3, markupPct: 25 }), 13.5526);
  assert.equal(applyRates(10, { scrapPct: 0, freightPct: 0, markupPct: 0 }), 10);
});

test("a vendor's price is its highest break at or below the quantity; below its lowest there is none", () => {
  const p = vendorPrices([{ quantity: 1000, unitCost: 1 }, { quantity: 100, unitCost: 2 }], [50, 100, 999, 5000], { scrapPct: 0, freightPct: 0, markupPct: 0 }, 250);
  assert.deepEqual(p.map((x) => x.unitPrice), [null, 2, 2, 1]);
  assert.match(p[0]?.warning ?? '', /lowest quantity \(100\)/);
  assert.match(p[1]?.warning ?? '', /minimum order \(250\)/);
  assert.equal(p[3]?.warning, null);
});

test('rates are checked', () => {
  assert.equal(rateProblem({ scrapPct: 100, freightPct: 0, markupPct: 0 }), 'Scrap must be less than 100%.');
  assert.equal(rateProblem({ scrapPct: 0, freightPct: -1, markupPct: 0 }), 'Freight must be zero or more.');
});
