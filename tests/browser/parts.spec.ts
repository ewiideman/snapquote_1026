// A part priced at its own quantities, set and cleared on the quote page.
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

test("a part's own quantities are entered on the row and cleared again", async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  const qid = (await (await jon.request.post('/api/quotes', { data: {} })).json()).id;
  await jon.request.patch(`/api/quotes/${qid}`, { data: { customerName: 'Locus Robotics', quantities: [100, 500] } });
  await jon.request.put(`/api/quotes/${qid}/lines`, { data: { lines: [{ partNumber: 'SP-1', revision: '', description: 'Spare fuse', qtyPer: 1, notes: '', department: 'procurement' }] } });
  await jon.goto(`/#/quotes/${qid}`);
  const row = jon.locator('table.grid.edit tbody tr').first();
  await expect(row.getByPlaceholder('Part number')).toHaveValue('SP-1');
  await row.hover();
  await row.getByRole('button', { name: 'Own quantities…' }).click();
  const box = row.locator('.own-qty input');
  await box.fill('25, 50');
  await box.press('Enter');
  await expect(row.getByText('own', { exact: true })).toBeVisible();
  await expect.poll(async () => (await (await jon.request.get(`/api/quotes/${qid}`)).json()).lines[0].quantities).toEqual([25, 50]);
  const line = (await (await jon.request.get(`/api/quotes/${qid}`)).json()).lines[0];
  expect(line.pieceQuantities).toEqual([25, 50]);
  await row.getByRole('button', { name: "Use the quote's quantities" }).click();
  await expect.poll(async () => (await (await jon.request.get(`/api/quotes/${qid}`)).json()).lines[0].pieceQuantities).toEqual([100, 500]);
  await expect(row.getByText('own', { exact: true })).toBeHidden();
});

test('a manager who priced every part is shown Review and send, and sends the departments back with one button', async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  const qid = (await (await jon.request.post('/api/quotes', { data: {} })).json()).id;
  await jon.request.patch(`/api/quotes/${qid}`, { data: { customerName: 'Locus Robotics', quantities: [100] } });
  await jon.request.put(`/api/quotes/${qid}/lines`, { data: { lines: [
    { partNumber: 'HW-1', revision: '', description: 'Screw', qtyPer: 4, notes: '', department: 'procurement' },
    { partNumber: 'ASM-1', revision: '', description: 'Final assembly', qtyPer: 1, notes: '', department: 'assembly' },
  ] } });
  expect((await jon.request.post(`/api/quotes/${qid}/send-to-estimating`, { data: {} })).status()).toBe(200);

  const boss = await signIn(browser, 'boss');
  const lines = (await (await boss.request.get(`/api/quotes/${qid}`)).json()).lines;
  for (const l of lines) {
    expect((await boss.request.put(`/api/lines/${l.id}/estimate`, { data: { basis: 'manual', prices: l.pieceQuantities.map((q: number) => ({ quantity: q, unitPrice: 2.5 })) } })).status()).toBe(200);
  }
  await boss.goto(`/#/quotes/${qid}`);
  const next = boss.locator('.next');
  await expect(next.getByText('Every part has a price.')).toBeVisible();
  await expect(next.getByRole('link', { name: 'Review and send' })).toBeVisible();
  await expect(next.getByText("Procurement, Assembly haven't marked their prices done. You can review and send now.")).toBeVisible();
  await next.getByRole('button', { name: "Send both departments' prices to Jon" }).click();
  await expect(next.getByText('Every department has priced it.')).toBeVisible();
  expect((await (await boss.request.get(`/api/quotes/${qid}`)).json()).stage).toBe('ready');
});
