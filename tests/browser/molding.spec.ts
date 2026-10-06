// Molding (ADC) prices a molded part with its calculator, through the screens.
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

test('the Molding calculator prices a part and the mold', async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  const qid = (await (await jon.request.post('/api/quotes', { data: {} })).json()).id;
  await jon.request.patch(`/api/quotes/${qid}`, { data: { customerName: 'Locus Robotics', quantities: [1000, 5000] } });
  await jon.request.put(`/api/quotes/${qid}/lines`, { data: { lines: [{ partNumber: 'HSG-1', revision: 'A', description: 'Housing', qtyPer: 1, notes: '', department: 'molding' }] } });
  expect((await jon.request.post(`/api/quotes/${qid}/send-to-estimating`, { data: {} })).status()).toBe(200);

  const adc = await signIn(browser, 'adc');
  await adc.goto(`/#/quotes/${qid}`);
  await adc.getByRole('button', { name: 'Price it' }).click();
  const panel = adc.locator('.panel');
  await expect(panel.getByText('Choose a resin.')).toBeVisible();
  // The panel scrolls with the mouse wheel, all the way to its button.
  const body = panel.locator('.body');
  expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await body.hover();
  await adc.mouse.wheel(0, 3000);
  await expect.poll(() => body.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await expect(panel.getByRole('button', { name: 'Use this price' })).toBeInViewport();
  await adc.mouse.wheel(0, -3000);
  await panel.getByLabel('Resin').selectOption('ABS');
  await panel.getByLabel('Annual volume (EAU)').fill('24000');
  await panel.getByLabel('Cavities', { exact: true }).fill('2');
  await panel.getByLabel('Cycle time (s)').fill('40');
  await panel.getByLabel('Part volume (in³)').fill('3');
  await panel.getByLabel('Wall (in)').fill('0.1');
  await panel.getByLabel('Runner length (in)').fill('6');
  await panel.getByLabel('Projected area (in²)').fill('20');
  await panel.getByLabel('Pressure (tons/in²)').fill('2.5');
  await panel.getByLabel('Length (in)', { exact: true }).fill('6');
  await panel.getByLabel('Width (in)', { exact: true }).fill('4');
  await panel.getByLabel('Height (in)', { exact: true }).fill('2');
  await expect(panel.getByText('Price each, at every quantity')).toBeVisible();
  await panel.getByLabel('Quote the china mold').check();
  await expect(panel.getByText('Mold (China), one time')).toBeVisible();
  await panel.getByRole('button', { name: 'Use this price' }).click();
  await expect(adc.getByText('Price saved for HSG-1 rev A.')).toBeVisible();
  const est = (await (await adc.request.get(`/api/quotes/${qid}`)).json()).lines[0].estimate;
  expect(est.oneTimeLabel).toBe('Mold (China)');
  expect(est.prices[0].unitPrice).toBe(est.prices[1].unitPrice);
});
