// Machining and Assembly price parts with their calculators, through the screens.
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

test('the Machining and Assembly calculators price a shaft and an assembly', async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  const qid = (await (await jon.request.post('/api/quotes', { data: {} })).json()).id;
  await jon.request.patch(`/api/quotes/${qid}`, { data: { customerName: 'Locus Robotics', quantities: [10, 100] } });
  await jon.request.put(`/api/quotes/${qid}/lines`, { data: { lines: [
    { partNumber: 'SHAFT-1', revision: '', description: 'Pivot shaft', qtyPer: 1, notes: '', department: 'machining' },
    { partNumber: 'ASSY-1', revision: '', description: 'Top assembly', qtyPer: 1, notes: '', department: 'assembly' },
  ] } });
  expect((await jon.request.post(`/api/quotes/${qid}/send-to-estimating`, { data: {} })).status()).toBe(200);

  const mach = await signIn(browser, 'mach');
  await mach.goto(`/#/quotes/${qid}`);
  await mach.getByRole('button', { name: 'Price it' }).first().click();
  const panel = mach.locator('.panel');
  await expect(panel.getByText('Choose the machine.')).toBeVisible();
  await panel.getByLabel('Machine', { exact: true }).selectOption('A20');
  await panel.getByLabel('Cycle time (s)').fill('70');
  await panel.getByLabel('Setup (hours)').fill('2');
  await panel.getByLabel('Operator time (0–1)', { exact: true }).fill('0.5');
  await panel.getByRole('button', { name: 'Custom price' }).click();
  await panel.getByLabel('Material each ($)').fill('1.25');
  await expect(panel.getByText('Price each').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Use this price' }).click();
  await expect(mach.getByText('Price saved for SHAFT-1.')).toBeVisible();

  const asm = await signIn(browser, 'asm');
  await asm.goto(`/#/quotes/${qid}`);
  await asm.getByRole('button', { name: 'Price it' }).first().click();
  const p2 = asm.locator('.panel');
  await p2.getByLabel('Assembly seconds, step 1').fill('120');
  await expect(p2.getByText('$2.16')).toBeVisible();
  await p2.getByRole('button', { name: 'Use this price' }).click();
  await expect(asm.getByText('Price saved for ASSY-1.')).toBeVisible();
  const lines = (await (await asm.request.get(`/api/quotes/${qid}`)).json()).lines;
  expect(lines.map((l: any) => l.estimate?.basis)).toEqual(['calculator', 'calculator']);
  expect(lines[1].estimate.prices[0].unitPrice).toBe(2.16);
});
