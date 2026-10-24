// A newer parts list against the quote's parts: added, no longer listed, changed, the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareParts, worthReviewing, type QuotePart } from '../../src/quoting/bom-compare.ts';

const quote: QuotePart[] = [
  { id: 1, partNumber: 'CR-5100-100', revision: 'B', description: 'Housing, front', qtyPer: 1 },
  { id: 2, partNumber: 'CR-5200-220', revision: 'A', description: 'Bracket, motor', qtyPer: 3 },
  { id: 3, partNumber: 'CR-9001-832', revision: '-', description: 'Nut, self-clinching 8-32', qtyPer: 4 },
  { id: 4, partNumber: '', revision: '', description: 'Final assembly and test', qtyPer: 1 },
];

test('a newer list: a part added, one gone, a new revision, a new quantity', () => {
  const c = compareParts(quote, [
    { partNumber: 'cr-5100-100 ', revision: 'C', description: 'Housing, front', qtyPer: 1 },
    { partNumber: 'CR-5200-220', revision: 'A', description: 'Bracket, motor', qtyPer: 4 },
    { partNumber: 'CR-5500-500', revision: 'A', description: 'Gasket, display', qtyPer: 1 },
    { partNumber: '', revision: '', description: 'final  assembly and TEST', qtyPer: 1 },
  ]);
  assert.deepEqual(c.added.map((p) => p.partNumber), ['CR-5500-500']);
  assert.deepEqual(c.removed.map((l) => l.id), [3]);
  assert.deepEqual(c.changed.map((x) => [x.line.id, x.what]), [[1, ['revision']], [2, ['quantity']]]);
  assert.equal(c.same, 1, 'the unnumbered part, matched by its description');
  assert.equal(worthReviewing(c), true);
});

test('two revisions of one part pair up with their own', () => {
  const two: QuotePart[] = [
    { id: 10, partNumber: 'P-1', revision: 'A', description: 'Shaft', qtyPer: 1 },
    { id: 11, partNumber: 'P-1', revision: 'B', description: 'Shaft', qtyPer: 1 },
  ];
  const c = compareParts(two, [{ partNumber: 'P-1', revision: 'B', description: 'Shaft', qtyPer: 1 }, { partNumber: 'P-1', revision: 'A', description: 'Shaft', qtyPer: 2 }]);
  assert.equal(c.same, 1);
  assert.deepEqual(c.changed.map((x) => [x.line.id, x.what]), [[10, ['quantity']]]);
});

test('a list with nothing in common is not a newer copy; one the same as the quote has nothing to review', () => {
  const other = compareParts(quote, [{ partNumber: 'AVL-1', revision: '', description: 'Vendor list', qtyPer: 1 }]);
  assert.equal(worthReviewing(other), false);
  const same = compareParts(quote, quote.map(({ id: _id, ...p }) => p));
  assert.equal(same.same, 4);
  assert.equal(worthReviewing(same), false);
  assert.equal(worthReviewing(compareParts([], [{ partNumber: 'X', revision: '', description: '', qtyPer: 1 }])), false);
  const more = compareParts(quote, [...quote.map(({ id: _id, ...p }) => p), { partNumber: 'NEW-1', revision: '', description: 'Gasket', qtyPer: 4 }]);
  assert.equal(worthReviewing(more), false, 'a list that only adds parts changes nothing: its parts are added');
});

test('a blank description in the new list does not count as a change', () => {
  const c = compareParts(quote.slice(0, 1), [{ partNumber: 'CR-5100-100', revision: 'B', description: '', qtyPer: 1 }]);
  assert.equal(c.same, 1);
});
