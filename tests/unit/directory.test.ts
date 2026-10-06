import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looseKey, planDirectoryImport } from '../../src/quoting/directory.ts';
import { emailDomainOf } from '../../src/quoting/email-domain.ts';

// Shaped like `\copy (SELECT * FROM customers ...) TO ... CSV HEADER` from the old SnapQuote.
const customers = [
  ['id', 'name', 'email', 'phone', 'address', 'city', 'state', 'zip_code', 'country', 'website', 'notes'],
  ['a1', 'Acme Medical', 'jane@acme-medical.com', '802-555-0100', '1 Main St', 'Bennington', 'VT', '05201', 'USA', '', ''],
  ['a2', '  acme   medical ', 'bob@acme-medical.com; tim@gmail.com', '', '', '', '', '', 'USA', '', 'second row'],
  ['b1', 'Acme Medical, Inc.', '', '', '', '', '', '', 'USA', '', ''],
  ['c1', 'Locus Robotics', 'buyer@locusrobotics.com', '', '', '', '', '', 'USA', '', ''],
  ['c2', 'Locus Robotics Corp', 'other@locusrobotics.com', '', '', '', '', '', 'USA', '', ''],
  ['d1', 'Stryker', 'x@stryker.com', '', '', '', '', '', 'USA', '', ''],
  ['e1', '', 'nobody@example.com', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', ''],
];

test('customers: one per name, every old row kept, domains from their emails, Stryker already here', () => {
  const plan = planDirectoryImport('customer', customers, [{ name: 'STRYKER', emailDomains: [] }]);
  assert.deepEqual(plan.add.map((e) => e.name), ['Acme Medical', 'Acme Medical, Inc.', 'Locus Robotics', 'Locus Robotics Corp']);
  const acme = plan.add[0];
  assert.equal(acme?.imported.length, 2, 'both rows for the same name are kept');
  assert.deepEqual(acme?.imported[0], { id: 'a1', name: 'Acme Medical', email: 'jane@acme-medical.com', phone: '802-555-0100', address: '1 Main St', city: 'Bennington', state: 'VT', zip_code: '05201', country: 'USA' });
  assert.deepEqual(acme?.emailDomains, ['acme-medical.com'], 'gmail is nobody\'s domain');
  assert.deepEqual(plan.repeated, [{ name: 'Acme Medical', rows: 2 }]);
  assert.deepEqual(plan.alreadyHere, ['STRYKER']);
  assert.deepEqual(plan.skipped, [{ row: 8, reason: 'no name' }]);
  assert.deepEqual(plan.nearDuplicates, [['Acme Medical', 'Acme Medical, Inc.'], ['Locus Robotics', 'Locus Robotics Corp']]);
  // locusrobotics.com is on both Locus rows: given to neither, rather than to whichever comes first.
  assert.deepEqual(plan.add.find((e) => e.name === 'Locus Robotics')?.emailDomains, []);
});

test('a domain a customer here already has is not given to a new one', () => {
  const plan = planDirectoryImport('customer', customers, [{ name: 'Acme (old)', emailDomains: ['acme-medical.com'] }]);
  assert.deepEqual(plan.add.find((e) => e.name === 'Acme Medical')?.emailDomains, []);
});

test('suppliers: the old table\'s columns are kept, no email domains', () => {
  const rows = [
    ['id', 'name', 'category', 'rating', 'location', 'payment_terms', 'lead_time', 'certifications', 'status', 'contact_email'],
    ['s1', 'Circuit Co', 'PCB', '4.5', 'Nashua, NH', 'Net 30', '21', '{ISO9001,ITAR}', 'approved', 'sales@circuitco.com'],
  ];
  const plan = planDirectoryImport('supplier', rows, []);
  assert.equal(plan.add.length, 1);
  assert.deepEqual(plan.add[0]?.emailDomains, []);
  assert.equal(plan.add[0]?.imported[0]?.['certifications'], '{ISO9001,ITAR}');
});

test('a file without a name column is refused, saying what it found', () => {
  assert.throws(() => planDirectoryImport('customer', [['id', 'email'], ['1', 'a@b.com']], []), /no name column.*id, email/);
});

test('names are compared loosely only to flag them', () => {
  assert.equal(looseKey('The Acme Co.'), 'acme');
  assert.equal(looseKey('Smith & Sons, LLC'), 'smith and sons');
  assert.equal(looseKey('Co'), 'co', 'a name that is only a suffix stays itself');
});

test('email domains: company domains only', () => {
  assert.equal(emailDomainOf('Jane@Acme-Medical.com'), 'acme-medical.com');
  assert.equal(emailDomainOf('jane@acme.com>'), 'acme.com');
  assert.equal(emailDomainOf('someone@gmail.com'), null);
  assert.equal(emailDomainOf('not an address'), null);
  assert.equal(emailDomainOf(null), null);
});
