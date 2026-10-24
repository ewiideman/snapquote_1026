// The drawings beside a part being priced: drawings and models only, the part's own first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawingsFor } from '../../src/ui/lib/drawings.ts';

const files = [
  { id: 1, lineId: null, fileName: 'RFQ - Northfield Robotics.msg' },
  { id: 2, lineId: null, fileName: 'NR-1200_PartsList_RevA.xlsx' },
  { id: 3, lineId: null, fileName: 'Assembly overview.pdf' },
  { id: 4, lineId: null, fileName: 'NR-1210_RevA.pdf' },
  { id: 5, lineId: null, fileName: 'nr 1210 housing.STEP' },
  { id: 6, lineId: 9, fileName: 'scan.jpg' },
];

test("the part's own drawings first, then the quote's other drawings; no emails or parts lists", () => {
  const r = drawingsFor(files, { id: 9, partNumber: 'NR-1210' });
  assert.deepEqual(r.map((x) => [x.file.id, x.own, x.opens]), [[4, true, true], [5, true, false], [6, true, true], [3, false, true]]);
});

test('a short or missing part number matches nothing by name', () => {
  assert.deepEqual(drawingsFor(files, { id: 1, partNumber: '' }).filter((x) => x.own).length, 0);
  assert.deepEqual(drawingsFor(files, { id: 1, partNumber: '12' }).filter((x) => x.own).length, 0);
});
