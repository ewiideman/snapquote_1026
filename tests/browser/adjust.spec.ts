// Business development adjusts every price at once on Review and send; an administrator changes a markup.
import { test, expect, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'browser-test-1';

async function signIn(browser: Browser, id: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.getByLabel('Username').fill(id);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  return page;
}

test('every price adjusted at once, and taken off again', async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  const qid = (await (await jon.request.post('/api/quotes', { data: {} })).json()).id;
  await jon.request.patch(`/api/quotes/${qid}`, { data: { customerName: 'Locus Robotics', quantities: [100] } });
  await jon.request.put(`/api/quotes/${qid}/lines`, { data: { lines: [{ partNumber: 'HW-1', revision: '', description: 'Screw', qtyPer: 4, notes: '', department: 'procurement' }] } });
  expect((await jon.request.post(`/api/quotes/${qid}/send-to-estimating`, { data: {} })).status()).toBe(200);
  const kevin = await signIn(browser, 'kevin');
  const line = (await (await kevin.request.get(`/api/quotes/${qid}`)).json()).lines[0];
  expect((await kevin.request.put(`/api/lines/${line.id}/estimate`, { data: { basis: 'manual', prices: [{ quantity: 400, unitPrice: 2.5 }] } })).status()).toBe(200);

  await jon.goto(`/#/quotes/${qid}/send`);
  await jon.getByRole('button', { name: 'Adjust every price…' }).click();
  const dialog = jon.getByRole('dialog');
  await dialog.getByLabel('Percent').fill('10');
  await dialog.getByLabel('Why').fill('Target margin for this customer');
  await expect(dialog.getByText('At 100: $10.00 → $11.00 an assembly')).toBeVisible();
  await dialog.getByRole('button', { name: 'Adjust every price' }).click();
  await expect(jon.getByText("Every price is the department's")).toBeVisible();
  await expect(jon.locator('.sheet').getByText('$2.75').first()).toBeVisible();
  await jon.getByRole('button', { name: 'Change the adjustment' }).click();
  await jon.getByRole('dialog').getByRole('button', { name: 'Take it off' }).click();
  await expect(jon.getByText("Every price is the department's")).toBeHidden();
  await expect(jon.locator('.sheet').getByText('$2.50').first()).toBeVisible();
});

test('an administrator changes a markup under Settings', async ({ browser }) => {
  const admin = await signIn(browser, 'admin');
  await admin.goto('/#/settings');
  const input = admin.getByLabel('Metals Sheet material and hardware');
  await expect(input).toHaveValue('20');
  await input.fill('25');
  await admin.locator('tr', { has: input }).getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Metals: Sheet material and hardware is now 25%.')).toBeVisible();
  await expect(admin.getByText('20% (changed)')).toBeVisible();
  await admin.getByRole('heading', { name: 'Markups' }).scrollIntoViewIfNeeded();
});
