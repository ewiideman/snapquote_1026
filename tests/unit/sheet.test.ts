import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheet, lineQuantities, parseQuantities, qtyKey, sendToEstimatingProblems, stageOf, waitingOn, type PricedLine } from '../../src/quoting/sheet.ts';

const priced = (id: number, qtyPer: number, prices: [number, number][], opts: Partial<PricedLine> = {}): PricedLine => ({
  id, qtyPer, quantities: [], department: 'metals',
  estimate: { prices: new Map(prices.map(([q, p]) => [qtyKey(q), p])), oneTimeCost: 0, oneTimeLabel: '', leadTimeWeeks: null },
  overrides: new Map(), ...opts,
});

test('stage: ready only when every live request is answered', () => {
  assert.equal(stageOf('estimating', [{ department: 'metals', status: 'answered' }, { department: 'procurement', status: 'open' }]), 'estimating');
  assert.equal(stageOf('estimating', [{ department: 'metals', status: 'answered' }, { department: 'procurement', status: 'withdrawn' }]), 'ready');
  assert.equal(stageOf('estimating', []), 'estimating');
  assert.equal(stageOf('sent', []), 'sent');
  assert.deepEqual(waitingOn([{ department: 'metals', status: 'open' }, { department: 'molding', status: 'question' }]), { departments: ['metals'], questions: ['molding'] });
});

test("a line's quantities are the assembly breaks times quantity per, unless it has its own", () => {
  assert.deepEqual(lineQuantities([100, 500], { id: 1, qtyPer: 4, quantities: [] }), [400, 2000]);
  assert.deepEqual(lineQuantities([100, 500], { id: 1, qtyPer: 0.5, quantities: [] }), [50, 250]);
  assert.deepEqual(lineQuantities([100, 500], { id: 1, qtyPer: 4, quantities: [25] }), [25]);
});

test('assembly price is the sum of unit price × quantity per; a missing price leaves it missing', () => {
  const s = buildSheet([100, 500], [priced(1, 2, [[200, 1.5], [1000, 1.2]]), priced(2, 1, [[100, 10], [500, 8]])]);
  assert.deepEqual(s.assembly?.map((b) => b.unitPrice), [13, 10.4]);
  assert.deepEqual(s.assembly?.map((b) => b.extended), [1300, 5200]);
  assert.equal(s.complete, true);
  const partial = buildSheet([100, 500], [priced(1, 2, [[200, 1.5]]), priced(2, 1, [[100, 10], [500, 8]])]);
  assert.deepEqual(partial.assembly?.map((b) => b.unitPrice), [13, null]);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, [{ lineId: 1, quantities: [1000] }]);
});

test("business development's price wins over the estimate", () => {
  const s = buildSheet([100], [priced(1, 1, [[100, 10]], { overrides: new Map([[qtyKey(100), { unitPrice: 9, reason: 'match last year' }]]) })]);
  const cell = s.lines[0]?.cells[0];
  assert.equal(cell?.estimated, 10);
  assert.equal(cell?.unitPrice, 9);
  assert.equal(cell?.overrideReason, 'match last year');
});

test('separate parts have no assembly price; one-time costs add up; lead time is the longest', () => {
  const s = buildSheet([100], [
    priced(1, 1, [[100, 10]], { estimate: { prices: new Map([[qtyKey(100), 10]]), oneTimeCost: 1500, oneTimeLabel: 'Tooling', leadTimeWeeks: 6 } }),
    priced(2, 1, [[50, 3]], { quantities: [50], estimate: { prices: new Map([[qtyKey(50), 3]]), oneTimeCost: 250, oneTimeLabel: 'NRE', leadTimeWeeks: 10 } }),
  ]);
  assert.equal(s.assembly, null);
  assert.equal(s.oneTimeTotal, 1750);
  assert.equal(s.leadTimeWeeks, 10);
  assert.equal(s.complete, true);
});

test('an unpriced line is missing, never zero', () => {
  const s = buildSheet([100], [{ id: 1, qtyPer: 1, quantities: [], department: 'metals', estimate: null, overrides: new Map() }]);
  assert.equal(s.lines[0]?.cells[0]?.unitPrice, null);
  assert.equal(s.complete, false);
});

test('what stops a draft going to the departments is said in words', () => {
  assert.deepEqual(sendToEstimatingProblems({ customer: false, quantities: [], lines: [] }), ['Name the customer.', 'Add at least one part.']);
  assert.deepEqual(sendToEstimatingProblems({ customer: true, quantities: [], lines: [{ id: 1, partNumber: '', description: '', department: null, quantities: [] }] }),
    ['One part has no part number or description.', 'Choose who prices one part.', 'Enter at least one quantity.']);
  assert.deepEqual(sendToEstimatingProblems({ customer: true, quantities: [], lines: [{ id: 1, partNumber: 'A', description: '', department: 'metals', quantities: [5] }] }), []);
});

test('quantities typed freely', () => {
  assert.deepEqual(parseQuantities('500, 100 1k 100'), { quantities: [100, 500, 1000], problem: null });
  assert.deepEqual(parseQuantities('2.5k'), { quantities: [2500], problem: null });
  assert.equal(parseQuantities('lots').problem, '"lots" is not a quantity.');
});
