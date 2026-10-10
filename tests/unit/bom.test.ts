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

test('a Part Number column beats an Item (find number) column before it', () => {
  const r = proposeLines([{ name: 'BOM', rows: [
    ['Item', 'Part Number', 'Rev', 'Description', 'Qty Per'],
    ['1', '100-4410', 'B', 'Mounting bracket, left', '2'],
  ] }]);
  assert.equal(r.lines[0]?.partNumber, '100-4410');
});

test('Item Number is a part number when nothing better is there; a bare Item only as a last resort', () => {
  assert.equal(proposeLines([{ name: 'S', rows: [['Item Number', 'Description'], ['MMP008482', 'Bracket']] }]).lines[0]?.partNumber, 'MMP008482');
  assert.equal(proposeLines([{ name: 'S', rows: [['Item', 'Description'], ['X-1', 'Cover']] }]).lines[0]?.partNumber, 'X-1');
  assert.equal(proposeLines([{ name: 'S', rows: [['Item', 'Item No.', 'Description'], ['1', 'A-7', 'Cover']] }]).lines[0]?.partNumber, 'A-7');
});

test("a column headed with the customer's name is their part number: KPD P/N, Acme Part Number, Customer Part #", () => {
  for (const header of ['KPD P/N', 'Acme Part Number', 'Customer Part #', 'Cust. P/N']) {
    const r = proposeLines([{ name: 'Form', rows: [['Line', header, 'Rev', 'Description', 'Qty / Assy'], ['1', '4100-1010', 'B', 'Chassis, base', '1']] }]);
    assert.equal(r.lines[0]?.partNumber, '4100-1010', header);
    assert.equal(r.lines[0]?.revision, 'B', header);
  }
});

test("the customer's number beats a manufacturer's or vendor's, whichever column comes first", () => {
  const rows = (a: string, b: string) => [[a, b, 'Description', 'Qty'], ['MFR-77', '4100-2002', 'Fan, 80 mm', '2']];
  assert.equal(proposeLines([{ name: 'S', rows: rows('Mfr P/N', 'Part Number') }]).lines[0]?.partNumber, '4100-2002');
  assert.equal(proposeLines([{ name: 'S', rows: rows('Vendor Part #', 'KPD P/N') }]).lines[0]?.partNumber, '4100-2002');
  // With nothing better, a manufacturer's number or MPN is still the part number.
  assert.equal(proposeLines([{ name: 'S', rows: [['MPN', 'Description'], ['EE80251', 'Fan']] }]).lines[0]?.partNumber, 'EE80251');
});

test('an old or alternate number is never taken as the part number', () => {
  const r = proposeLines([{ name: 'S', rows: [['Old P/N', 'Description', 'Qty'], ['100-9', 'Cover', '1']] }]);
  assert.equal(r.lines[0]?.partNumber, '');
  assert.equal(r.lines[0]?.description, 'Cover');
  assert.equal(proposeLines([{ name: 'S', rows: [['Alt. Part No.', 'Part Number', 'Description'], ['X', '200-1', 'Cover']] }]).lines[0]?.partNumber, '200-1');
});

test('a PLM export headed Number / Version / Name: the version letter is the revision, the version kept in the notes', () => {
  const r = proposeLines([{ name: 'export.csv', rows: [
    ['Level', 'Number', 'Version', 'Name', 'Quantity', 'Unit', 'State'],
    ['1', '4100-1010', 'B.1', 'CHASSIS, BASE', '1', 'ea', 'RELEASED'],
    ['1', 'HW-0632-0375', '', 'SCREW, PAN HD', '22', 'ea', 'RELEASED'],
    ['1', '4100-2010', '2', 'DISPLAY MODULE', '1', 'ea', 'RELEASED'],
  ] }]);
  assert.deepEqual(r.lines.map((l) => [l.partNumber, l.revision, l.notes]), [
    ['4100-1010', 'B', 'Level 1. Version in the file: "B.1"'],
    ['HW-0632-0375', '', 'Level 1'],
    ['4100-2010', '', 'Level 1. Version in the file: "2"'],
  ]);
  // A Rev column, when there is one, is the revision and is taken as written.
  assert.equal(proposeLines([{ name: 'S', rows: [['Part Number', 'Rev', 'Version', 'Description'], ['1', 'C.2', 'D.1', 'x']] }]).lines[0]?.revision, 'C.2');
});

test('a TOTAL or SUBTOTAL row is not a part', () => {
  const r = proposeLines([{ name: 'Form', rows: [
    ['Line', 'KPD P/N', 'Description', 'Qty / Assy', 'Unit Price @ 250'],
    ['1', '4100-1010', 'CHASSIS, BASE', '1', ''],
    ['', '', 'TOTAL OF COMPONENT PRICES PER ASSEMBLY (LINES 2-28)', '', '=SUM(E2:E3)'],
    ['', 'Subtotal', '', '', ''],
    ['', 'Grand total', '', '', ''],
    ['2', 'TOT-55', 'Total station mount', '1', ''],
    // A merged TOTAL label repeats into every column it covers.
    ['', 'TOTAL', 'TOTAL', 'TOTAL', '15.75'],
    ['', '', 'Grand Total (USD)', '', ''],
    ['', '', 'Total tooling', '', ''],
    ['', '', 'Order total:', '', ''],
    // Parts whose names only start with the word stay.
    ['', '', 'Total station bracket', '1', ''],
    ['', 'TOTAL-100', '', '1', ''],
  ] }]);
  assert.deepEqual(r.lines.map((l) => l.partNumber || l.description), ['4100-1010', 'TOT-55', 'Total station bracket', 'TOTAL-100']);
});

test('a parent or assembly number is never the part number', () => {
  const rows = [['1', '4100-0001', '100-200', 'Bracket', '2'], ['1', '4100-0001', '100-201', 'Cover', '1']];
  for (const [parent, own] of [['Parent Part Number', 'Component'], ['Parent P/N', 'Part Number'], ['Assy P/N', 'Part Number'], ['Top Level P/N', 'Customer Part Number']]) {
    const r = proposeLines([{ name: 'S', rows: [['Level', parent, own, 'Description', 'Qty Per'], ...rows] }]);
    assert.deepEqual(r.lines.map((l) => l.partNumber), ['100-200', '100-201'], `${parent} / ${own}`);
  }
  assert.deepEqual(proposeLines([{ name: 'S', rows: [['Item Number', 'Description', 'Qty', 'Next Higher Assy P/N'], ['100-200', 'Bracket', '2', '4100-0001']] }]).lines.map((l) => l.partNumber), ['100-200']);
});

test("a distributor's, substitute, tooling or the quoting supplier's own number is never the part number", () => {
  const take = (header: string[], row: string[]) => proposeLines([{ name: 'S', rows: [header, row] }]).lines[0]?.partNumber;
  assert.equal(take(['Designator', 'Comment', 'Manufacturer', 'Manufacturer Part Number', 'Digi-Key Part Number', 'Quantity'], ['R1', '10k', 'Yageo', 'RC0603FR-0710KL', '311-10.0KHRCT-ND', '1']), 'RC0603FR-0710KL');
  assert.equal(take(['Ref Des', 'Description', 'MPN', 'Mouser P/N', 'Qty'], ['R1', '10k', 'RC0603FR-0710KL', '603-RC0603FR-0710KL', '1']), 'RC0603FR-0710KL');
  assert.equal(take(['Item Number', 'Item Description', 'Rev', 'Qty', 'Approved Mfr', 'Approved Mfr P/N'], ['600-0001', 'Fan', 'B', '1', 'EBM', 'EE80251']), '600-0001');
  for (const other of ['Substitute P/N', 'Legacy P/N', 'Mold P/N', 'Material P/N', 'Suppl. P/N', 'Supplier Part Number', 'Distributor P/N']) {
    assert.equal(take(['Item Number', 'Description', 'Qty', other], ['100-200', 'Bracket', '1', 'X-9']), '100-200', other);
  }
  assert.equal(take(['Mack Part Number', 'Customer Part Number', 'Rev', 'Description'], ['', '4100-1010', 'B', 'Chassis']), '4100-1010');
  assert.equal(take(['Item', 'Your Part #', 'Part Number', 'Description', 'Qty'], ['1', '', '100-200', 'Bracket', '1']), '100-200');
});

test("a manufacturer's number beats a find number; the customer's beats both", () => {
  const take = (header: string[], row: string[]) => proposeLines([{ name: 'S', rows: [header, row] }]).lines[0]?.partNumber;
  assert.equal(take(['Item #', 'Qty', 'Ref Des', 'Manufacturer', 'Manufacturer Part Number', 'Description'], ['1', '4', 'C1-C4', 'Murata', 'GRM188R71H104KA93D', 'Cap']), 'GRM188R71H104KA93D');
  assert.equal(take(['Mfr Part', 'Description'], ['LM358DR', 'Op amp']), 'LM358DR');
  assert.equal(take(['Item #', 'Description', 'Manuf. P/N'], ['1.2', 'Op amp', 'LM358DR']), 'LM358DR');
  assert.equal(take(['Item Number', 'Description', 'Manuf. P/N'], ['100-200', 'Op amp', 'LM358DR']), '100-200');
  assert.equal(take(['MPN', 'Part Number', 'Description'], ['LM358DR', '600-0001', 'Op amp']), '600-0001');
});

test('"Number" is the part number only in a PLM export, and beats a find number there', () => {
  assert.equal(proposeLines([{ name: 'S', rows: [['Number', 'Description', 'Qty'], ['1', 'Bracket', '2']] }]).lines[0]?.partNumber, '');
  assert.equal(proposeLines([{ name: 'S', rows: [['Level', 'Item', 'Number', 'Version', 'Name', 'Quantity'], ['1', '10', '4100-1010', 'B.1', 'CHASSIS', '1']] }]).lines[0]?.partNumber, '4100-1010');
  assert.equal(proposeLines([{ name: 'S', rows: [['Number', 'Version', 'Name', 'Mfr Part Number'], ['4100-2002', 'A.1', 'FAN', 'EE80251']] }]).lines[0]?.partNumber, '4100-2002');
});

test('revision columns: a named Rev beats Version; versions as PLM writes them', () => {
  const rev = (header: string[], row: string[]) => proposeLines([{ name: 'S', rows: [header, row] }]).lines[0]?.revision;
  for (const h of ['KPD Rev', 'Item Revision', 'Dwg Rev', 'Rev #', 'Rev No.']) assert.equal(rev(['Part Number', h, 'Description', 'Version'], ['4100-1010', 'D', 'Chassis', '2']), 'D', h);
  const r = proposeLines([{ name: 'S', rows: [['Number', 'Version', 'Name'], ['A-1', 'A.2 (Design)', 'x'], ['A-2', '-.1', 'y'], ['A-3', '7/7', 'z'], ['A-4', 'C', 'w']] }]);
  assert.deepEqual(r.lines.map((l) => [l.revision, l.notes]), [['A', 'Version in the file: "A.2 (Design)"'], ['-', 'Version in the file: "-.1"'], ['', 'Version in the file: "7/7"'], ['C', '']]);
});

test('a title block above the table is not taken for its header', () => {
  const r = proposeLines([{ name: 'S', rows: [['Customer P/N', '4100-0001', 'Rev', 'C'], [], ['Part Number', 'Description', 'EAU'], ['100-200', 'Bracket', '500']] }]);
  assert.equal(r.headerRow, 2);
  assert.deepEqual(r.lines.map((l) => [l.partNumber, l.description]), [['100-200', 'Bracket']]);
  const t = proposeLines([{ name: 'S', rows: [['Top Assembly P/N', '4100-0001', 'Rev', 'C', 'Description', 'CONTROL BOX'], [], ['Find No', 'Part Number', 'Description', 'Qty'], ['1', '100-200', 'Bracket', '2']] }]);
  assert.equal(t.headerRow, 2);
});

test('a revision-history sheet does not win over the parts sheet', () => {
  const r = proposeLines([
    { name: 'Revision History', rows: [['Version', 'Date', 'Description', 'Approved'], ['1.0', '2026-01-02', 'Initial release', 'JS']] },
    { name: 'Parts', rows: [['Part Number', 'Description'], ['100-200', 'Bracket']] },
  ]);
  assert.equal(r.sheet, 'Parts');
});

test('a title block naming the customer part number, followed by the table, is not the header', () => {
  const r = proposeLines([{ name: 'S', rows: [
    ['Customer P/N', '4100-1000', 'Rev', 'C'],
    ['ITEM NO.', 'PART NUMBER', 'REV', 'DESCRIPTION', 'QTY'],
    ['1', '4100-1010', 'B', 'CHASSIS', '1'],
    ['2', '4100-1011', 'A', 'BRACKET, FAN', '2'],
  ] }]);
  assert.equal(r.headerRow, 1);
  assert.deepEqual(r.lines.map((l) => l.partNumber), ['4100-1010', '4100-1011']);
});

test('assembly, distributor, material and supplier columns lose to the part number columns beside them', () => {
  const pick = (head: string[], row: string[]) => proposeLines([{ name: 'S', rows: [head, row] }]).lines[0]?.partNumber;
  assert.equal(pick(['Assy. P/N', 'Item Number', 'Description'], ['4100-1000', '4100-1010', 'Chassis']), '4100-1010');
  assert.equal(pick(['ASM P/N', 'Item No.', 'Description'], ['4100-1000', '4100-1010', 'Chassis']), '4100-1010');
  assert.equal(pick(['DK P/N', 'MPN', 'Description'], ['296-1395-1-ND', 'LM358DR', 'Op amp']), 'LM358DR');
  assert.equal(pick(['McMaster P/N', 'Mfr P/N', 'Description'], ['91251A146', 'SHCS-632-38', 'Screw']), 'SHCS-632-38');
  assert.equal(pick(['Colorant P/N', 'Item No.', 'Description'], ['CLR-9001', '4100-1020', 'Bezel']), '4100-1020');
  assert.equal(pick(["Mat'l P/N", 'Item No.', 'Description'], ['PC-2405', '4100-1020', 'Bezel']), '4100-1020');
  const form = proposeLines([{ name: 'S', rows: [["Supplier's Part Number", 'Item Number', 'Description'], ['', '4100-1010', 'Chassis']] }]);
  assert.equal(form.lines[0]?.partNumber, '4100-1010');
});

test("the customer's own words win: Our Part Number beats the manufacturer's", () => {
  const r = proposeLines([{ name: 'S', rows: [['Mfr P/N', 'Our Part Number', 'Description'], ['LM358DR', 'KPD-0042', 'Op amp']] }]);
  assert.equal(r.lines[0]?.partNumber, 'KPD-0042');
});

test("a revision of another document is not the part's: BOM Rev, From Rev, Assy. Rev", () => {
  const rev = (head: string[], row: string[]) => proposeLines([{ name: 'S', rows: [head, row] }]).lines[0]?.revision;
  assert.equal(rev(['Part Number', 'BOM Rev', 'Item Rev', 'Description'], ['100-200', 'D', 'B', 'Bracket']), 'B');
  assert.equal(rev(['Part Number', 'From Rev', 'Description'], ['100-200', 'A', 'Bracket']), '');
  assert.equal(rev(['Part Number', 'Assy. Rev', 'Description'], ['100-200', 'C', 'Bracket']), '');
});

test('Number and Version count only in a PLM export, not on a sheet that merely has a Name column', () => {
  const r = proposeLines([{ name: 'S', rows: [['Number', 'Name', 'Qty'], ['12', 'Bracket', '2']] }]);
  assert.deepEqual(r.lines.map((l) => [l.partNumber, l.description, l.qtyPer]), [['', 'Bracket', 2]]);
  const v = proposeLines([{ name: 'S', rows: [['Part Number', 'Version', 'Description'], ['100-200', '3', 'Bracket']] }]);
  assert.equal(v.lines[0]?.revision, '');
});

test('a total line with no quantity is skipped, whatever it totals', () => {
  const r = proposeLines([{ name: 'S', rows: [
    ['P/N', 'Description', 'Qty', 'Unit Price'],
    ['100-200', 'Bracket', '2', '4.10'],
    ['', 'Total Unit Price', '', '8.20'],
    ['', 'TOTAL ASSEMBLY COST', '', '8.20'],
  ] }]);
  assert.deepEqual(r.lines.map((l) => l.partNumber), ['100-200']);
});

// Third review (Oct 10): layouts the second restructure got wrong, and nearby gaps in the customer's own number.

test("Item Number holding the customer's numbers beats the manufacturer's number, which made parts do not have", () => {
  for (const mfr of ['Mfr. P/N', 'MFG P/N', 'Mfr P/N', "Manufacturer's Part Number"]) {
    const r = proposeLines([{ name: 'BOM', rows: [
      ['Item Number', 'Rev', 'Description', 'Qty', 'Find Num', 'Mfr. Name', mfr],
      ['4100-1010', 'B', 'BRACKET', '1', '10', '', ''],
      ['4100-1011', 'A', 'BRACKET', '1', '20', '', ''],
      ['300-0042', 'A', 'RES 10K', '2', '30', 'Yageo', 'RC0603FR-0710KL'],
    ] }]);
    assert.deepEqual(r.lines.map((l) => l.partNumber), ['4100-1010', '4100-1011', '300-0042'], mfr);
  }
});

test("the customer's own column beats find numbers and a manufacturer's number filled only for bought parts", () => {
  const pns = (rows: string[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  assert.deepEqual(pns([['Item No.', 'KPD P/N', 'Rev', 'Description', 'Qty'], ['1', '4100-1010', 'B', 'CHASSIS', '1'], ['2', '4100-1011', 'A', 'BRACKET', '2']]), ['4100-1010', '4100-1011']);
  assert.deepEqual(pns([['Item', 'Qty', 'Ref Des', 'KPD P/N', 'Description', 'Mfr', 'Mfr P/N'],
    ['1', '2', 'R1,R2', 'KPD-0001', 'RES 10K 0603', 'Yageo', 'RC0603FR-0710KL'], ['2', '1', '', 'KPD-2001', 'BRACKET', '', ''], ['3', '1', '', 'KPD-2002', 'BRACKET', '', '']]),
    ['KPD-0001', 'KPD-2001', 'KPD-2002']);
  // A distributor's column filled no more often than the MPN does not displace it.
  assert.deepEqual(pns([['Waytek P/N', 'MPN', 'Description'], ['W-1', 'LM358DR', 'Op amp'], ['W-2', 'NE555', 'Timer']]), ['LM358DR', 'NE555']);
});

test('find numbers never stand in for an empty part number column when the rows have descriptions', () => {
  const r = proposeLines([{ name: 'S', rows: [['ITEM NO.', 'PART NUMBER', 'DESCRIPTION', 'QTY.'], ['1', '', 'BASE PLATE', '1'], ['2', '', 'SIDE PANEL, LH', '1'], ['1.1', '', 'SIDE PANEL, RH', '1']] }]);
  assert.deepEqual(r.lines.map((l) => [l.partNumber, l.description]), [['', 'BASE PLATE'], ['', 'SIDE PANEL, LH'], ['', 'SIDE PANEL, RH']]);
  // With no description, they are all there is to tell the rows apart.
  assert.deepEqual(proposeLines([{ name: 'S', rows: [['No.', 'Qty', 'Material'], ['1', '2', 'CRS']] }]).lines.map((l) => l.partNumber), ['1']);
});

test('headings written other ways: punctuation, required marks, parentheses, two-word customer names', () => {
  const pn = (h: string) => proposeLines([{ name: 'S', rows: [['Line', h, 'Rev', 'Description', 'Qty'], ['1', '4100-1010', 'B', 'BRACKET', '1']] }]).lines[0]?.partNumber;
  for (const h of ['P.N.', 'PN#', 'PN #', 'Part Num.', 'Part-Number', 'Part_Number', 'PART_NO', 'Part Nbr', 'P/No.', 'Part Number *', 'Part Number (Customer)',
    'Customer Part No. (required)', 'Part No:', 'CPN', 'Boston Scientific P/N', 'Thermo Fisher Part Number', 'Welch Allyn Part No.', 'Philips 12NC', 'Customer Item Number']) {
    assert.equal(pn(h), '4100-1010', h);
  }
  for (const h of ['P/N (Supplier)', 'Part Number (Vendor)', 'Next Assy P/N', 'Top-Level P/N', 'Sub-Assy P/N', 'Digi-Key Part Number']) assert.equal(pn(h), '', h);
  const qty = proposeLines([{ name: 'S', rows: [['Part Number', 'Qty (per assy)'], ['4100-1010', '3']] }]).lines[0]?.qtyPer;
  assert.equal(qty, 3);
});

test('revision headings: Revision Number, Rev Lvl, RevisionNum; a component revision beats a bare Rev', () => {
  const rev = (header: string[], row: string[]) => proposeLines([{ name: 'S', rows: [header, row] }]).lines[0]?.revision;
  for (const h of ['Revision Number', 'Rev Num', 'RevisionNum', 'Rev Letter', 'Rev Lvl']) assert.equal(rev(['Part Number', h, 'Description'], ['100-200', 'C', 'Bracket']), 'C', h);
  assert.equal(rev(['Assy P/N', 'Rev', 'Part Number', 'Part Rev', 'Description', 'Qty'], ['4100-0001', 'D', '100-200', 'B', 'Bracket', '1']), 'B');
  assert.equal(rev(['Assembly', 'Revision', 'Component', 'Component Revision', 'Description'], ['4100-0001', 'D', '100-200', 'B', 'Bracket']), 'B');
});

test("Part Number beats Drawing No. and an electrical BOM's Part (the value); the component beats its parent", () => {
  const take = (header: string[], row: string[]) => proposeLines([{ name: 'S', rows: [header, row] }]).lines[0]?.partNumber;
  assert.equal(take(['Line', 'Drawing No.', 'Part No.', 'Rev', 'Description'], ['1', '4100-1010', '4100-1010-01', 'C', 'BRACKET']), '4100-1010-01');
  assert.equal(take(['Item', 'Quantity', 'Reference', 'Part', 'Part Number', 'Description'], ['1', '2', 'R1,R2', '10K', '300-0042', 'RES 10K']), '300-0042');
  assert.equal(take(['Item', 'Quantity', 'Reference', 'Part', 'Manufacturer', 'Manufacturer Part Number'], ['1', '2', 'R1,R2', '10K', 'Yageo', 'RC0603FR-0710KL']), 'RC0603FR-0710KL');
  assert.equal(take(['Line', 'Part', 'Description', 'Qty'], ['1', 'X-1', 'Cover', '1']), 'X-1');
  assert.equal(take(['Item', 'Member Item', 'Description', 'Quantity'], ['4100-0001', '4100-1010', 'Chassis', '1']), '4100-1010');
  assert.equal(take(['Company', 'PartNum', 'RevisionNum', 'MtlSeq', 'MtlPartNum', 'QtyPer'], ['MACK', '4100-0001', 'C', '10', '4100-1010', '1']), '4100-1010');
  assert.equal(take(['Item', 'Material', 'Short Text', 'Quantity', 'OUn'], ['10', '4100-1010', 'CHASSIS', '1', 'EA']), '4100-1010');
  assert.equal(take(['Type', 'No.', 'Description', 'Quantity per'], ['Item', '4100-1010', 'BRACKET', '1']), '4100-1010');
});

test('two heading rows are read as one: Part over No., merged headings, group headings over price breaks', () => {
  const lines = (rows: string[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => [l.partNumber, l.revision, l.description, l.qtyPer]);
  assert.deepEqual(lines([['Part', 'Rev', 'Description', 'Qty'], ['No.', 'Rev', 'Description', 'Per Assy'], ['4100-2010', 'C', 'Bracket', '2'], ['4100-2011', 'C', 'Bracket', '2']]),
    [['4100-2010', 'C', 'Bracket', 2], ['4100-2011', 'C', 'Bracket', 2]]);
  assert.deepEqual(lines([['Part', '', '', 'Qty'], ['Number', 'Rev', 'Description', 'Per Assy'], ['4100-2010', 'C', 'Bracket', '2']]), [['4100-2010', 'C', 'Bracket', 2]]);
  assert.deepEqual(lines([['Item', 'Part', 'Rev', 'Description', 'Qty', 'Unit', 'Ext.'], ['Item', 'Number', 'Rev', 'Description', 'Per Assy', 'Price', 'Price'], ['1', '4100-1010', 'B', 'Chassis, base', '1']]),
    [['4100-1010', 'B', 'Chassis, base', 1]]);
  assert.deepEqual(lines([['Part', 'Part', 'Part', 'Quantity', 'Quantity', 'Unit Price', 'Unit Price'], ['Number', 'Rev', 'Description', 'Per Assy', 'EAU', '100', '500'], ['4100-2010', 'C', 'Bracket', '2', '1000', '', '']]),
    [['4100-2010', 'C', 'Bracket', 2]]);
  const r = proposeLines([
    { name: 'Rev History', rows: [['Rev', 'Description', 'Date', 'By'], ['A', 'Initial release', '2025-03-01', 'JS']] },
    { name: 'BOM', rows: [['Part', 'Rev', 'Description', 'Qty'], ['No.', 'Rev', 'Description', 'Per Assy'], ['4100-1010', 'B', 'Chassis, base', '1']] },
  ]);
  assert.equal(r.sheet, 'BOM');
});

test('a title block of labels and values is never the header, on the same sheet or a cover sheet', () => {
  const block = [['ACME MEDICAL - REQUEST FOR QUOTATION'], ['Customer P/N', '4100-0001', 'Customer Rev', 'C', 'Description', 'Pump housing assy'], ['RFQ No.', 'Q-2026-118', 'Due Date', '2026-10-15', 'EAU', '500']];
  const table = [['Item', 'Part Number', 'Description', 'Qty', 'Unit Price'], ['1', '4100-1010', 'Chassis, base', '1', ''], ['2', '4100-2010', 'Bracket, left', '2', '']];
  const same = proposeLines([{ name: 'RFQ', rows: [...block, [], ...table] }]);
  assert.equal(same.headerRow, 4);
  assert.deepEqual(same.lines.map((l) => l.partNumber), ['4100-1010', '4100-2010']);
  const cover = proposeLines([{ name: 'Cover', rows: block }, { name: 'BOM', rows: table }]);
  assert.equal(cover.sheet, 'BOM');
  // A form with price breaks as headings is a table, not a title block.
  const breaks = proposeLines([{ name: 'S', rows: [['Part Number', '100', '500', '1000'], ['4100-1010', '', '', '']] }]);
  assert.deepEqual(breaks.lines.map((l) => l.partNumber), ['4100-1010']);
});

test('a part named "TOTAL ..." stays when it has a quantity, A/R or REF', () => {
  const r = proposeLines([{ name: 'S', rows: [['ITEM NO.', 'PART NUMBER', 'DESCRIPTION', 'QTY.'], ['1', '4100-1010', 'CHASSIS, BASE', '1'],
    ['2', '', 'TOTAL CERAN XM 220 GREASE', 'A/R'], ['3', '', 'TOTAL STATION MOUNT ADAPTER', 'REF'], ['4', '', 'TOTAL MULTIS EP 2', '']] }]);
  assert.deepEqual(r.lines.map((l) => l.description), ['CHASSIS, BASE', 'TOTAL CERAN XM 220 GREASE', 'TOTAL STATION MOUNT ADAPTER', 'TOTAL MULTIS EP 2']);
});

test("Excel's subtotal rows, a repeated header and a merged banner are not parts", () => {
  const sub = proposeLines([{ name: 'S', rows: [['Part Number', 'Rev', 'Description', 'Qty'], ['100-200', 'B', 'BRACKET, LEFT', '2'], ['100-200 Total', '', '', '2'],
    ['HW-0632', '', 'SCREW', '8'], ['HW-0632 Total', '', '', '8'], ['Grand Total', '', '', '10']] }]);
  assert.deepEqual(sub.lines.map((l) => l.partNumber), ['100-200', 'HW-0632']);
  const title = '4100-0100 FRAME WELDMENT';
  const sections = proposeLines([{ name: 'S', rows: [['Item', 'Part Number', 'Rev', 'Description', 'Qty Per'], ['1', '4100-1010', 'B', 'Chassis', '1'], [],
    [title, title, title, title, title], ['Item', 'Part Number', 'Rev', 'Description', 'Qty Per'], ['1', '4100-0110', 'A', 'Rail, left', '2']] }]);
  assert.deepEqual(sections.lines.map((l) => l.partNumber), ['4100-1010', '4100-0110']);
  const note = 'Enter your price in the yellow cells';
  const form = proposeLines([{ name: 'S', rows: [['Line', 'KPD P/N', 'Rev', 'Description', 'Qty', 'Unit Price'], [note, note, note, note, note, note], ['1', '4100-1010', 'B', 'Chassis', '1', '']] }]);
  assert.deepEqual(form.lines.map((l) => l.partNumber), ['4100-1010']);
});

test('a quantity written with a piece unit is read; any other text is kept in the notes', () => {
  const r = proposeLines([{ name: 'S', rows: [['Part Number', 'Qty'], ['A-1', '2 EA'], ['A-2', '8 PCS'], ['A-3', '(4)'], ['A-4', '2 FT']] }]);
  assert.deepEqual(r.lines.map((l) => [l.qtyPer, l.notes]), [[2, ''], [8, ''], [1, 'Quantity per in the file: "(4)"'], [1, 'Quantity per in the file: "2 FT"']]);
});

// Fourth review (Oct 10).

test('a line-number column stays a find number with section headings, notes, alternates or REF among its values', () => {
  const mpns = (rows: unknown[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  const head = ['Item', 'Qty', 'Ref Des', 'Description', 'Manufacturer', 'Manufacturer Part Number'];
  assert.deepEqual(mpns([head, ['PCB ASSEMBLY'], [1, 2, 'C1,C2', 'CAP 0.1UF', 'Murata', 'GRM188R71H104KA93D'], [2, 1, 'R1', 'RES 10K', 'Yageo', 'RC0603FR-0710KL'],
    ['CABLE ASSEMBLY'], [1, 1, 'P1', 'HOUSING', 'Molex', '0022013107'], [2, 10, '', 'TERMINAL', 'Molex', '0008500114']]),
    ['GRM188R71H104KA93D', 'RC0603FR-0710KL', '0022013107', '0008500114']);
  assert.deepEqual(mpns([['Item', 'Item Number', 'Rev', 'Description', 'Qty'], ['1', '4100-1010', 'B', 'CHASSIS', '1'], ['2', '4100-2010', 'C', 'BRACKET', '2'], ['2A', '4100-2011', 'A', 'BRACKET (ALT)', '']]),
    ['4100-1010', '4100-2010', '4100-2011']);
});

test('short numeric part numbers are part numbers, not find numbers', () => {
  const pns = (rows: unknown[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  assert.deepEqual(pns([['Find Num', 'Item Number', 'Item Description', 'Item Rev', 'Qty'], [10, 3105, 'GASKET', 'B', 1], [20, 3106, 'GASKET', 'A', 1], [30, 4410, 'COVER', 'C', 1]]), ['3105', '3106', '4410']);
  assert.deepEqual(pns([['Item Number', 'Description', 'Qty'], [1042, 'GASKET', 1], [1043, 'GASKET', 1]]), ['1042', '1043']);
});

test("a board, harness or distributor column does not displace the manufacturer's number", () => {
  const pns = (rows: unknown[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  assert.deepEqual(pns([['CCA P/N', 'Ref Des', 'Qty', 'Description', 'Manufacturer', 'Manufacturer Part Number'],
    ['500-1001', 'C1', 2, 'CAP', 'Murata', 'GRM188'], ['500-1001', 'R1', 1, 'RES', 'Yageo', 'RC0603'], ['500-1001', '', 1, 'PCB, BARE', '', ''], ['500-1002', 'U1', 1, 'IC', 'TI', 'LM358DR']]),
    ['GRM188', 'RC0603', '', 'LM358DR']);
  assert.deepEqual(pns([['Item', 'Description', 'Qty', 'Manufacturer', 'Manufacturer Part Number', 'Waytek P/N'],
    [1, 'WIRE, RED', '12 FT', '', '', '33204'], [2, 'WIRE, BLACK', '12 FT', '', '', '33200'], [3, 'HOUSING', 2, 'Molex', '43025-0400', '17014']]),
    ['', '', '43025-0400']);
});

test("an electrical BOM's Part column is the part number when it holds numbers, not values", () => {
  const pns = (rows: unknown[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  assert.deepEqual(pns([['Part', 'Rev', 'Description', 'Qty', 'Ref Des', 'Manufacturer', 'Manufacturer Part Number'],
    ['4100-1010', 'B', 'CHASSIS', 1, '', '', ''], ['4100-1020', 'A', 'BRACKET', 2, '', '', ''], ['600-0012', 'A', 'FUSE HOLDER', 1, 'F1', 'Littelfuse', '01550900M']]),
    ['4100-1010', '4100-1020', '600-0012']);
});

test('a quantity heading with another quantity in parentheses is not the quantity per', () => {
  const qty = (h: string) => proposeLines([{ name: 'S', rows: [['Part Number', 'Description', h], ['4100-1010', 'CHASSIS', 500]] }]).lines[0]?.qtyPer;
  for (const h of ['Quantity (EAU)', 'Qty (Annual)', 'Qty (Proto)', 'Qty (MOQ)']) assert.equal(qty(h), 1, h);
  for (const h of ['Qty (per assy)', 'Qty (EA)', 'Quantity (Each)']) assert.equal(qty(h), 500, h);
});

test('customer names with digits, ampersands and accents', () => {
  const pn = (h: string) => proposeLines([{ name: 'S', rows: [['Line', h, 'Description'], ['1', '78-8125-1234-5', 'BRACKET']] }]).lines[0]?.partNumber;
  for (const h of ['3M Part Number', 'Fisher & Paykel P/N', 'Johnson & Johnson P/N', 'Dräger P/N']) assert.equal(pn(h), '78-8125-1234-5', h);
  assert.equal(pn('2nd Source P/N'), '');
});

test('a sheet title alone in A1 is not stacked onto the headings', () => {
  const r = proposeLines([{ name: 'BOM', rows: [['Bill of Materials'], ['Part Number', 'Description', 'Rev', 'Qty', 'Dwg No.'],
    ['4100-1010-01', 'BRACKET, LH', 'B', '1', '4100-1010'], ['4100-1010-02', 'BRACKET, RH', 'B', '1', '4100-1010']] }]);
  assert.deepEqual(r.lines.map((l) => l.partNumber), ['4100-1010-01', '4100-1010-02']);
});

test('a title block over a note line is still a title block; a one-row assembly table above the BOM does not swallow it', () => {
  const bom = [['ITEM NO.', 'PART NUMBER', 'DESCRIPTION', 'QTY.'], ['1', '4100-1010', 'CHASSIS, BASE', '1'], ['2', '4100-1011', 'BRACKET', '2']];
  const cover = proposeLines([{ name: 'RFQ', rows: [['ACME MEDICAL - RFQ'], ['Customer P/N:', '4100-0001', 'Rev:', 'C', 'Description:', 'CONTROL BOX'], ['Quote 500 and 1,000 pc lots'], ['Buyer:', 'J. Smith']] },
    { name: 'BOM', rows: bom }]);
  assert.equal(cover.sheet, 'BOM');
  const same = proposeLines([{ name: 'BOM', rows: [['Customer P/N:', '4100-0001', 'Rev:', 'C', 'Description:', 'CONTROL BOX'], ['NOTE: QUOTE 500 AND 1,000 PC LOTS'], [], ...bom] }]);
  assert.deepEqual(same.lines.map((l) => [l.partNumber, l.qtyPer]), [['4100-1010', 1], ['4100-1011', 2]]);
  const assy = proposeLines([{ name: 'RFQ', rows: [['Customer P/N', 'Rev', 'Description', 'EAU'], ['4100-0001', 'C', 'CONTROL BOX', '500'], [], ...bom] }]);
  assert.deepEqual(assy.lines.map((l) => [l.partNumber, l.qtyPer]), [['4100-0001', 1], ['4100-1010', 1], ['4100-1011', 2]]);
});

test('a charge row merged over part number to quantity is kept', () => {
  const r = proposeLines([{ name: 'S', rows: [['Line', 'Part Number', 'Description', 'Qty', 'Unit Price'], ['1', '4100-1010', 'CHASSIS', '1', ''], ['2', 'Tooling', 'Tooling', 'Tooling', '']] }]);
  assert.deepEqual(r.lines.map((l) => l.partNumber), ['4100-1010', 'Tooling']);
});

// Fifth review (Oct 10).

test('a block beside the table (revision history, tooling) does not take over the header', () => {
  const pns = (rows: unknown[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  assert.deepEqual(pns([['Line', 'Part Number', 'Rev', 'Description', 'Qty', '', 'REVISION HISTORY'], ['1', '4100-1010', 'B', 'BEZEL', '1', '', 'Rev', 'Description', 'Date'],
    ['2', '4100-1011', 'C', 'BASE', '1', '', 'A', 'Initial release', '2025-03-01'], ['3', '4100-1012', 'A', 'DOOR', '1']]), ['4100-1010', '4100-1011', '4100-1012']);
  assert.deepEqual(pns([['Line', 'Part Number', 'Description', 'EAU', '', 'TOOLING'], ['1', '4100-1010', 'BEZEL', '5000'], ['2', '4100-1011', 'HOUSING', '5000', '', 'Description', 'Qty', 'Cost'],
    ['3', '4100-1012', 'DOOR', '5000', '', 'Family mold', '1', ''], ['4', '4100-1013', 'LENS', '5000']]), ['4100-1010', '4100-1011', '4100-1012', '4100-1013']);
});

test('a Yes/No column or a commodity word in the first row does not make it a header', () => {
  const r = proposeLines([{ name: 'S', rows: [['Part Number', 'Description', 'Commodity', 'Qty', 'Customer Supplied'], ['PC-2405', 'LEXAN 940 PC', 'Resin', '0.12', 'No'],
    ['CLR-9001', 'COLORANT', 'Colorant', '0.002', 'No'], ['INS-0440', 'INSERT, 4-40', 'Hardware', '4', 'Yes']] }]);
  assert.deepEqual(r.lines.map((l) => [l.partNumber, l.qtyPer]), [['PC-2405', 0.12], ['CLR-9001', 0.002], ['INS-0440', 4]]);
});

test("find numbers: a customer's all-digit numbers in Part, dotted part numbers, a Line Total column", () => {
  const pns = (rows: unknown[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  assert.deepEqual(pns([['Item', 'Quantity', 'Reference', 'Part', 'Description', 'Manufacturer', 'Mfr Part Number'], ['1', '2', 'R1,R2', '300042', 'RES 10K', 'Yageo', 'RC0603'],
    ['2', '1', '', '410020', 'BRACKET', '', ''], ['3', '1', '', '410021', 'BRACKET', '', '']]), ['300042', '410020', '410021']);
  assert.deepEqual(pns([['Item Number', 'Description', 'Qty'], ['10.1234.01', 'HOUSING', '1'], ['42.0016', 'GASKET', '1'], ['42.0017', 'GASKET', '1']]), ['10.1234.01', '42.0016', '42.0017']);
  assert.deepEqual(pns([['Item No.', 'Description', 'Manufacturer', 'Manufacturer Part Number', 'Qty', 'Unit Price', 'Line Total'], ['1', 'FAN', 'EBM', 'EE80251', '2', '', ''], ['2', 'OP AMP', 'TI', 'LM358DR', '1', '', '']]),
    ['EE80251', 'LM358DR']);
});

test('a title row of two cells over the headings is not stacked onto them', () => {
  const pns = (rows: unknown[][]) => proposeLines([{ name: 'S', rows }]).lines.map((l) => l.partNumber);
  assert.deepEqual(pns([['BILL OF MATERIAL', '', '', '', '', 'PROPRIETARY'], ['Part Number', 'Rev', 'Description', 'Qty', 'Dwg No.'], ['4100-1010-01', 'B', 'BRACKET, LH', '1', '4100-1010'],
    ['4100-1010-02', 'B', 'BRACKET, RH', '1', '4100-1010']]), ['4100-1010-01', '4100-1010-02']);
  assert.deepEqual(pns([['BILL OF MATERIAL', 'BILL OF MATERIAL'], ['Item', 'Part Number', 'Rev', 'Description', 'Qty', 'Manufacturer', 'Mfr P/N'], ['1', '4100-1010', 'B', 'CHASSIS', '1', '', ''],
    ['2', '600-0012', 'A', 'FUSE HOLDER', '1', 'Littelfuse', '01550900M']]), ['4100-1010', '600-0012']);
});

test('a price form with only part numbers filled in is a table, not a title block', () => {
  const r = proposeLines([
    { name: 'Instructions', rows: [['ACME MEDICAL - RFQ'], [], ['Column', 'Description'], ['Part Number', 'ACME part number. Do not change.'], ['Unit Price', 'Price per piece in USD.']] },
    { name: 'Quote', rows: [['Part Number', 'Unit Price @ 100', 'Unit Price @ 500', 'Notes'], ['4100-1010'], ['4100-1011']] },
  ]);
  assert.equal(r.sheet, 'Quote');
  assert.deepEqual(r.lines.map((l) => l.partNumber), ['4100-1010', '4100-1011']);
});

test('sections on one sheet with their own headers are all read', () => {
  const r = proposeLines([{ name: 'BOM', rows: [['PURCHASED PARTS'], ['Item', 'Part Number', 'Description', 'Qty Per', 'Mfr', 'Mfr P/N'], ['1', 'HW-0632-0375', 'Screw, pan hd', '22', 'McMaster', '91772A146'],
    ['2', 'EL-FAN-80', 'Fan, 80 mm', '2', 'Sunon', 'EE80251S1'], [], ['FABRICATED PARTS'], ['Item', 'Part Number', 'Rev', 'Description', 'Qty Per', 'Material'],
    ['3', '4100-1010', 'B', 'Chassis, base', '1', 'CRS 16 ga'], ['4', '4100-2010', 'C', 'Bracket', '2', '5052 .080']] }]);
  assert.deepEqual(r.lines.map((l) => [l.partNumber, l.revision, l.qtyPer]), [['HW-0632-0375', '', 22], ['EL-FAN-80', '', 2], ['4100-1010', 'B', 1], ['4100-2010', 'C', 2]]);
});
