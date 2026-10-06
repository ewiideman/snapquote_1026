// The Quotes page on a varied board: each card's next step, the summary as filters, search and scope,
// and the layout in a narrow window and on a phone (no sideways page scroll; the board scrolls inside
// itself). Customers are named apart from the other specs' so the order the files run in does not matter.
import { test, expect, type Page } from '@playwright/test';
import { loadConfig } from '../../src/server/config.ts';
import { createDatabase } from '../../src/server/db.ts';
import { createAccount } from '../../src/persistence/accounts.ts';

const PASSWORD = 'browser-test-1';

test.beforeAll(async () => {
  const db = createDatabase(loadConfig({ databaseUrlVar: 'TEST_DATABASE_URL' }).database);
  await createAccount(db, null, { id: 'pat', displayName: 'Pat Admin', role: 'administrator', department: null, email: null, password: PASSWORD, temporary: false });
  await createAccount(db, null, { id: 'dana', displayName: 'Dana Ruiz', role: 'sales', department: null, email: null, password: PASSWORD, temporary: false });
  const cust: Record<string, number> = {};
  for (const name of ['Kestrel Labs', 'Orion Devices', 'Halcyon Imaging', 'Brightline Energy', 'Northeast Precision Surgical Instrument Holdings International']) {
    cust[name] = (await db.query<{ id: number }>('INSERT INTO quote.customer (name) VALUES ($1) RETURNING id', [name]))[0]!.id;
  }
  const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  let n = 0;
  const quote = async (o: { owner?: string; customer?: string; title?: string; status?: string; due?: number; lines?: number; itar?: boolean; sent?: number; closed?: number; award?: number; requests?: [string, string, number?][] }) => {
    n++;
    const id = (await db.query<{ id: number }>(
      `INSERT INTO quote.quote (number, customer_id, title, owner_id, status, customer_due_on, itar, sent_at, closed_at, award_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [`B26-${String(n).padStart(4, '0')}`, o.customer ? cust[o.customer] : null, o.title ?? '', o.owner ?? 'pat', o.status ?? 'draft', o.due === undefined ? null : day(o.due),
        !!o.itar, o.sent === undefined ? null : hoursAgo(o.sent), o.closed === undefined ? null : hoursAgo(o.closed), o.award ?? null]))[0]!.id;
    for (let i = 0; i < (o.lines ?? 0); i++) await db.query('INSERT INTO quote.line (quote_id, position, part_number) VALUES ($1, $2, $3)', [id, i + 1, `P-${i}`]);
    for (const [department, status, neededBy] of o.requests ?? []) {
      await db.query('INSERT INTO quote.request (quote_id, department, status, needed_by, sent_by) VALUES ($1, $2, $3, $4, $5)', [id, department, status, neededBy === undefined ? null : day(neededBy), 'pat']);
    }
  };
  await quote({});
  await quote({ title: 'RFQ: Bracket rework for the handheld scanner housing', lines: 3 });
  await quote({ customer: 'Halcyon Imaging', title: 'Imaging cart side panels', due: -5 });
  await quote({ customer: 'Orion Devices', title: 'Controller enclosure, sheet-metal chassis with machined heat sink, PEM hardware, powder coat and silk-screen front panel, plus kitting', lines: 4, due: 2 });
  await quote({ owner: 'dana', customer: 'Orion Devices', title: 'Battery door, two-shot overmold', lines: 2, due: 12 });
  await quote({ customer: 'Kestrel Labs', title: 'Drill handle and trigger assembly', status: 'estimating', due: 10, lines: 6, requests: [['metals', 'answered'], ['molding', 'open', 3], ['procurement', 'question', 3]] });
  await quote({ customer: 'Brightline Energy', title: 'Junction box, 316 stainless', status: 'estimating', due: -2, lines: 3, requests: [['metals', 'open', -1]] });
  await quote({ customer: 'Northeast Precision Surgical Instrument Holdings International', title: 'Guidance fixture', itar: true, status: 'estimating', due: 30, lines: 5, requests: [['machining', 'open'], ['assembly', 'answered']] });
  await quote({ customer: 'Kestrel Labs', title: 'Pump housing', status: 'estimating', due: 1, lines: 2, requests: [['metals', 'answered'], ['procurement', 'answered']] });
  await quote({ customer: 'Halcyon Imaging', title: 'Detector mount', status: 'sent', lines: 3, sent: 72 });
  await quote({ customer: 'Kestrel Labs', title: 'Irrigation pump frame', status: 'won', lines: 4, sent: 400, closed: 120, award: 48250 });
  await quote({ customer: 'Brightline Energy', title: 'Cable tray brackets', status: 'lost', lines: 2, closed: 240 });
  await db.close();
});

async function signIn(page: Page, id: string) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.getByLabel('Username').fill(id);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Quotes', exact: true })).toBeVisible();
}
const card = (page: Page, text: string) => page.locator('.qcard', { hasText: text });
const fitsSideways = (page: Page) => page.locator('html').evaluate((e) => e.scrollWidth <= e.clientWidth);

test('each card says what the quote needs next; the summary, search and scope filter the board', async ({ page }) => {
  await signIn(page, 'pat');
  await page.getByRole('button', { name: "Everyone's" }).click();
  await expect(card(page, 'B26-0001')).toContainText('Customer not set');
  await expect(card(page, 'B26-0001')).toContainText('Add the customer and parts');
  await expect(card(page, 'B26-0002')).toContainText('Add the customer');
  await expect(card(page, 'Imaging cart side panels')).toContainText('Add the parts');
  await expect(card(page, 'Imaging cart side panels')).toContainText('5 days late');
  const asked = card(page, 'Drill handle');
  await expect(asked.locator('.dept.done')).toContainText('priced');
  await expect(asked.locator('.dept.wait')).toContainText('working');
  await expect(asked.locator('.dept.ask')).toContainText('has a question');
  await expect(asked).toContainText("Answer Procurement's question");
  await expect(card(page, 'Junction box')).toContainText('Prices were needed');
  await expect(card(page, 'Guidance fixture')).toContainText('ITAR');
  await expect(page.locator('.column', { hasText: 'Ready to send' }).locator('.qcard', { hasText: 'Pump housing' })).toContainText('Review and send');
  await expect(card(page, 'Detector mount')).toContainText('Sent 3 days ago');
  await expect(card(page, 'Irrigation pump frame')).toContainText('$48k');

  // The summary filters the board, and says which filter is on.
  await page.getByRole('button', { name: /Overdue/ }).click();
  await expect(page.locator('.filter-chip')).toContainText('Overdue');
  await expect(card(page, 'Imaging cart side panels')).toBeVisible();
  await expect(card(page, 'Junction box')).toBeVisible();
  await expect(card(page, 'Drill handle')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show every quote' }).click();
  await expect(card(page, 'Drill handle')).toBeVisible();

  await page.getByLabel('Search quotes').fill('orion');
  await expect(page.locator('.qcard')).toHaveCount(2);
  await page.getByLabel('Search quotes').fill('no such quote');
  await expect(page.getByText('Nothing here matches.')).toHaveCount(5);
  await page.getByLabel('Search quotes').fill('');

  await page.getByRole('button', { name: 'My quotes' }).click();
  await expect(page.getByRole('button', { name: 'My quotes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'Battery door')).toHaveCount(0);
  await page.getByRole('button', { name: "Everyone's" }).click();
  await expect(card(page, 'Battery door')).toBeVisible();

  // A card opens from the keyboard.
  await card(page, 'Detector mount').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/quotes\/\d+$/);
});

test('a narrow window keeps the page still and scrolls the board; a phone gets a menu', async ({ browser }) => {
  const narrow = await browser.newPage({ viewport: { width: 950, height: 800 } });
  await signIn(narrow, 'pat');
  await narrow.getByRole('button', { name: "Everyone's" }).click();
  await expect(card(narrow, 'Drill handle')).toBeVisible();
  expect(await fitsSideways(narrow)).toBe(true);
  const board = narrow.locator('.board');
  expect(await board.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await narrow.getByRole('button', { name: 'Show later stages' }).click();
  await expect.poll(() => board.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  await expect(narrow.getByRole('button', { name: 'Show earlier stages' })).toBeVisible();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(phone, 'pat');
  expect(await fitsSideways(phone)).toBe(true);
  await expect(phone.getByRole('link', { name: 'Settings' })).toBeHidden();
  await phone.getByRole('button', { name: 'Open the menu' }).click();
  await phone.getByRole('link', { name: 'Settings' }).click();
  await expect(phone).toHaveURL(/#\/settings$/);
  await expect(phone.getByRole('link', { name: 'Settings' })).toBeHidden();
  await phone.getByRole('button', { name: 'Open the menu' }).click();
  await phone.getByRole('button', { name: 'Sign out' }).click();
  await expect(phone.getByLabel('Username')).toBeVisible();
});
