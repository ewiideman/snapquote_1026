// A quote through the screens: the RFQ email dropped on the board, Metals and Procurement pricing,
// review, the customer's copy, sent and won.
import { test, expect, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'browser-test-1';
const csv = 'Part Number,Rev,Description,Qty Per\n100-200,B,Mounting bracket,2\nPCB-77,,Controller board,1\n';
const eml = ['From: Jane Buyer <jane@acme-medical.com>', 'Subject: RFQ: Controller enclosure', 'Date: Mon, 05 Oct 2026 09:30:00 -0400', 'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain', '', 'Please quote 100 and 500.', '--b1',
  'Content-Type: text/csv; name="bom.csv"', 'Content-Disposition: attachment; filename="bom.csv"', 'Content-Transfer-Encoding: base64', '',
  Buffer.from(csv).toString('base64'), '--b1--', ''].join('\r\n');

async function signIn(browser: Browser, id: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.getByLabel('Username').fill(id);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

test('from RFQ email to won', async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  // His own email address, for the emails SnapQuote sends him.
  await jon.goto('/#/account');
  await jon.getByLabel('Your email address').fill('jon.whitney@mack.com');
  await jon.getByRole('button', { name: 'Save address' }).click();
  await expect(jon.getByText('Email address saved.')).toBeVisible();
  await jon.goto('/');
  await expect(jon.getByText('Good', { exact: false }).first()).toBeVisible();
  // Files are gathered first -- dropped one at a time here -- and the quote starts when asked.
  await jon.locator('.drop input[type=file]').setInputFiles({ name: 'RFQ.eml', mimeType: 'message/rfc822', buffer: Buffer.from(eml) });
  await expect(jon.getByText('1 file for the new quote')).toBeVisible();
  await jon.locator('.drop input[type=file]').setInputFiles({ name: 'drawing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await jon.locator('.drop input[type=file]').setInputFiles({ name: 'oops.txt', mimeType: 'text/plain', buffer: Buffer.from('not this one') });
  await jon.getByRole('button', { name: 'Remove oops.txt' }).click();
  await expect(jon.getByText('2 files for the new quote')).toBeVisible();
  await jon.getByRole('button', { name: 'Start the quote', exact: true }).click();
  await expect(jon).toHaveURL(/#\/quotes\/\d+$/);
  const url = jon.url();
  await expect(jon.getByText('From the email “RFQ: Controller enclosure”')).toBeVisible();
  await expect(jon.locator('table.grid tbody tr')).toHaveCount(2);
  await expect(jon.locator('.files')).toContainText('drawing.pdf');
  await expect(jon.locator('.files')).not.toContainText('oops.txt');
  await expect(jon.getByText(/To send it to the departments/)).toBeVisible();

  await jon.getByPlaceholder('Type a name — new ones are added').fill('Acme Medical');
  await jon.getByPlaceholder('Type a name — new ones are added').blur();
  await expect(jon.getByText('✓ All changes saved')).toBeVisible();
  // A date typed one key at a time: the half-typed years (0002, 0020, 0202) are never saved.
  const due = jon.locator('label', { hasText: 'Customer wants it by' }).locator('input[type=date]');
  await due.click();
  await jon.keyboard.type('10202026');
  await due.blur();
  await expect(due).toHaveValue('2026-10-20');
  const id = jon.url().split('/').pop();
  await expect.poll(async () => (await (await jon.request.get(`/api/quotes/${id}`)).json()).quote.customerDueOn).toBe('2026-10-20');
  await jon.getByPlaceholder('e.g. 100, 500, 1k').fill('100, 500');
  await jon.keyboard.press('Enter');
  await expect(jon.locator('.qty-chips .q')).toHaveCount(2);
  await jon.locator('table.grid select').nth(0).selectOption('metals');
  await expect(jon.locator('table.grid select').nth(0)).toHaveValue('metals');
  await jon.locator('table.grid select').nth(1).selectOption('procurement');
  await expect(jon.getByText('Ready for the departments.')).toBeVisible();
  await jon.getByRole('button', { name: 'Send to the departments' }).click();
  await expect(jon.getByText('Waiting on Metals, Procurement.')).toBeVisible();

  // Metals prices the bracket by hand and sends its prices back.
  const chris = await signIn(browser, 'chris');
  await expect(chris.getByRole('heading', { name: 'Metals queue' })).toBeVisible();
  await chris.getByText('Acme Medical').click();
  await chris.getByRole('button', { name: 'Price it' }).click();
  await chris.locator('.panel .tabs button', { hasText: 'Enter prices' }).click();
  await chris.getByLabel('Price each at 200').fill('6.95');
  await chris.getByLabel('Price each at 1000').fill('6.54');
  await chris.locator('.panel').getByRole('button', { name: 'Save price' }).click();
  await chris.getByRole('button', { name: 'Send prices to Jon' }).click();
  await expect(chris.getByText('Metals has priced its parts.')).toBeVisible();

  // Procurement prices the board from a vendor quote.
  const kevin = await signIn(browser, 'kevin');
  await kevin.goto(url);
  await kevin.getByRole('button', { name: 'Price it' }).click();
  await kevin.getByRole('button', { name: '+ Add a vendor quote' }).click();
  const panel = kevin.locator('.panel');
  await panel.getByLabel('Vendor').fill('Circuit Co');
  const costs = panel.locator('.card table input');
  await costs.nth(1).fill('20');
  await costs.nth(3).fill('15');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await panel.getByLabel('Markup %').fill('20');
  await expect(panel.getByText('$18.00')).toBeVisible();
  await panel.getByRole('button', { name: 'Use this price' }).click();
  await kevin.getByRole('button', { name: 'Send prices to Jon' }).click();

  // Business development reviews, sets one price, downloads the copy, sends, and wins.
  await jon.goto('/');
  await expect(jon.locator('.column', { hasText: 'Ready to send' }).getByText('Acme Medical')).toBeVisible();
  await jon.goto(`${url}/send`);
  await expect(jon.locator('.totals')).toContainText('$37.90'); // 6.95 × 2 + 24.00
  await jon.locator('.sheet button.pricebtn').nth(3).click(); // the board at 500
  await jon.getByLabel('Your price each ($)').fill('17.50');
  await jon.getByLabel('Why (everyone on the quote sees this)').fill('Volume commitment');
  await jon.getByRole('button', { name: 'Use my price' }).click();
  await expect(jon.locator('.totals')).toContainText('$30.58'); // 6.54 × 2 + 17.50
  const pdf = await jon.request.get(`/api/quotes/${url.split('/').pop()}/pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  await jon.getByRole('button', { name: 'Mark as sent' }).click();
  await jon.getByRole('button', { name: "It's sent" }).click();
  await jon.getByRole('button', { name: 'Won' }).click();
  await jon.getByLabel('Customer PO number').fill('PO-778');
  await jon.getByRole('button', { name: 'Record it' }).click();
  await jon.goto('/');
  await jon.getByRole('button', { name: "Everyone's" }).click();
  await expect(jon.locator('.column', { hasText: 'Closed lately' }).getByText('Acme Medical')).toBeVisible();

  // The customer came back: reopen it as a revision, in a dialog rather than a browser prompt.
  await jon.goto(url);
  await jon.getByRole('button', { name: 'Reopen as a revision' }).click();
  await jon.getByLabel('Why is it being reopened?').fill('New quantity of 2,500');
  await jon.getByRole('button', { name: 'Open revision 1' }).click();
  await expect(jon.locator('.qhead .number')).toContainText('rev 1');

  // A stray draft is deleted, the deletion undone, and deleted again.
  await jon.goto('/');
  await jon.getByRole('button', { name: 'Start a blank quote' }).click();
  await expect(jon).toHaveURL(/#\/quotes\/\d+$/);
  const stray = jon.url();
  await jon.getByRole('button', { name: 'Delete quote' }).click();
  await jon.getByLabel('Why? (optional)').fill('Started by mistake');
  await jon.locator('.dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(jon).toHaveURL(/#\/$/);
  await jon.getByRole('button', { name: 'Undo' }).click();
  await expect(jon).toHaveURL(stray);
  await expect(jon.getByRole('button', { name: 'Delete quote' })).toBeVisible();
  await jon.getByRole('button', { name: 'Delete quote' }).click();
  await jon.locator('.dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await jon.getByRole('link', { name: 'Deleted quotes' }).click();
  await expect(jon.getByText('Started by mistake')).toHaveCount(0);
  await expect(jon.locator('table.grid tbody tr')).toHaveCount(1);
});

