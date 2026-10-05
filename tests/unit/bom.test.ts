import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeLines } from '../../src/quoting/bom.ts';

test('finds the header below a title block and reads the parts', () => {
  const r = proposeLines([{ name: 'BOM', rows: [
    ['ACME Corp RFQ 2291'], [],
    ['Find #', 'Part Number', 'Rev', 'Description', 'Qty Per', 'Material'],
    ['1', '100-200', 'B', 'Bracket, left', '2', '5052-H32 .080'],
    ['2', '100-201', '', 'Cover', '', ''],
    ['', '', '', '', '', ''],
    ['3', '', '', 'Label kit', 'TBD', ''],
  ] }]);
  assert.equal(r.headerRow, 2);
  assert.deepEqual(r.lines, [
    { partNumber: '100-200', revision: 'B', description: 'Bracket, left', qtyPer: 2, notes: 'Material: 5052-H32 .080' },
    { partNumber: '100-201', revision: '', description: 'Cover', qtyPer: 1, notes: '' },
    { partNumber: '', revision: '', description: 'Label kit', qtyPer: 1, notes: 'Quantity per in the file: "TBD"' },
  ]);
});

test('picks the sheet whose header names the most columns', () => {
  const r = proposeLines([
    { name: 'Notes', rows: [['Description'], ['see drawing']] },
    { name: 'Parts', rows: [['P/N', 'Description', 'Qty'], ['X1', 'Shaft', '1']] },
  ]);
  assert.equal(r.sheet, 'Parts');
  assert.equal(r.lines[0]?.partNumber, 'X1');
});

test('says why nothing was taken', () => {
  assert.match(proposeLines([{ name: 'S', rows: [['a', 'b'], ['1', '2']] }]).problem ?? '', /No column headed part number or description/);
});
