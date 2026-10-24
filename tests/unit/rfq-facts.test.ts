// What an RFQ email says plainly: the customer from its signature, the quantities and the due date from
// the lines the customer labeled. Nothing guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyFromEmail, dueDateFromEmail, quantitiesFromEmail, readDate } from '../../src/quoting/rfq-facts.ts';

const cobalt = `Hi Jon,

Cobalt Ridge Medical is requesting a quote for the housing assembly of our CR-500 ambulatory infusion pump.

Quantities (complete assemblies): 100, 300 and 600
Estimated annual usage: 2,400 assemblies after launch
Pilot build needed: March 2027
Quote due: Friday, November 13, 2026

Thanks,

Marcus Delgado
Supply Chain Manager
Cobalt Ridge Medical Systems, LLC
42 Foundry Lane, Lowell, MA 01852 (fictional)
(978) 555-0187
marcus.delgado@cobaltridge-medical.example`;

test('the customer is the signature line that names the sender\'s own domain', () => {
  assert.equal(companyFromEmail(cobalt, 'marcus.delgado@cobaltridge-medical.example'), 'Cobalt Ridge Medical Systems, LLC');
  assert.equal(companyFromEmail('Thanks,\nDana Whitfield\nSenior Buyer, Strategic Sourcing\nHarborview Instruments, Inc.\n1180 Wharf Road', 'dana@harborview-instruments.example'), 'Harborview Instruments, Inc.');
  assert.equal(companyFromEmail('Regards,\nPat\nACME Corp.\n', 'pat@acme.com'), 'ACME Corp.');
  assert.equal(companyFromEmail('Thanks\nKestrel Labs\n', 'buyer@kestrellabs.com'), 'Kestrel Labs');
});

test('no customer from a sentence, another company, or a shared mail service', () => {
  assert.equal(companyFromEmail('Cobalt Ridge Medical is requesting a quote for the housing.', 'm@cobaltridge-medical.com'), null);
  assert.equal(companyFromEmail('Thanks,\nMarcus\nArrow Electronics, Inc.\n', 'm@cobaltridge-medical.com'), null, 'a distributor\'s name is not the sender\'s company');
  assert.equal(companyFromEmail('Thanks,\nMarcus\nCobalt Ridge Medical Systems, LLC\n', 'marcus@gmail.com'), null);
  assert.equal(companyFromEmail('Thanks,\nMarcus\nCobalt Ridge Medical Systems, LLC\n', null), null);
  assert.equal(companyFromEmail('www.cobaltridge-medical.com\ncobaltridge-medical.com', 'm@cobaltridge-medical.com'), null);
});

test('quantities from the line labeled with them, never the annual usage', () => {
  assert.deepEqual(quantitiesFromEmail(cobalt), [100, 300, 600]);
  assert.deepEqual(quantitiesFromEmail('Quantities (complete assemblies): 250, 500 and 1,000\nEstimated annual usage: 1,000'), [250, 500, 1000]);
  assert.deepEqual(quantitiesFromEmail('Qty: 1k / 5k / 10k'), [1000, 5000, 10000]);
  assert.deepEqual(quantitiesFromEmail('- Quote quantities: 50, 100'), [50, 100]);
  assert.equal(quantitiesFromEmail('Annual quantity: 5,000'), null);
  assert.equal(quantitiesFromEmail('We need a good price on large quantities.'), null);
  assert.equal(quantitiesFromEmail('Quantities: see the attached BOM'), null);
});

test('the due date from the line that says the quote is due', () => {
  assert.equal(dueDateFromEmail(cobalt), '2026-11-13');
  assert.equal(dueDateFromEmail('Quote due: Friday, November 6, 2026'), '2026-11-06');
  assert.equal(dueDateFromEmail('Due date: 11/20/2026'), '2026-11-20');
  assert.equal(dueDateFromEmail('Please quote by: Dec 1, 2026'), '2026-12-01');
  assert.equal(dueDateFromEmail('Target first-article date: February 2027'), null);
  assert.equal(dueDateFromEmail('Pilot build needed: March 15, 2027'), null);
  assert.equal(readDate('February 30, 2027'), null);
  assert.equal(readDate('2026-11-13'), '2026-11-13');
});
