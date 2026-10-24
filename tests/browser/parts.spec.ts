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
  // Review and send says nothing is missing, and offers the same button.
  await boss.goto(`/#/quotes/${qid}/send`);
  await expect(boss.getByText('Every part has a price.')).toBeVisible();
  await expect(boss.getByText(/Still waiting/)).toHaveCount(0);
  await expect(boss.getByRole('button', { name: "Send both departments' prices to Jon" })).toBeVisible();
  await boss.goto(`/#/quotes/${qid}`);
  const next = boss.locator('.next');
  await expect(next.getByText('Every part has a price.')).toBeVisible();
  await expect(next.getByRole('link', { name: 'Review and send' })).toBeVisible();
  await expect(next.getByText("Procurement, Assembly haven't marked their prices done. You can review and send now.")).toBeVisible();
  await next.getByRole('button', { name: "Send both departments' prices to Jon" }).click();
  await expect(next.getByText('Every department has priced it.')).toBeVisible();
  expect((await (await boss.request.get(`/api/quotes/${qid}`)).json()).stage).toBe('ready');
});

test('a newer parts list dropped on the quote is reviewed, then the parts are brought up to it', async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  const qid = (await (await jon.request.post('/api/quotes', { data: {} })).json()).id;
  await jon.request.patch(`/api/quotes/${qid}`, { data: { customerName: 'Locus Robotics', quantities: [100] } });
  await jon.goto(`/#/quotes/${qid}`);
  const input = jon.locator('.section', { hasText: 'Files' }).locator('input[type=file]');
  const csv = (rows: string) => ({ name: 'bom.csv', mimeType: 'text/csv', buffer: Buffer.from(`Part Number,Rev,Description,Qty\n${rows}`) });
  await input.setInputFiles(csv('RV-1,A,Bracket,2\nRV-2,A,Cover,1\nRV-3,A,Shaft,1\n'));
  await expect(jon.locator('table.parts tbody tr')).toHaveCount(3);
  // The same file again (a copy, saved under another name) is not attached twice.
  await input.setInputFiles({ ...csv('RV-1,A,Bracket,2\nRV-2,A,Cover,1\nRV-3,A,Shaft,1\n'), name: 'bom (1).csv' });
  await expect(jon.locator('.toast')).toContainText('already on the quote');
  await input.setInputFiles({ ...csv('RV-1,A,Bracket,3\nRV-2,B,Cover,1\nRV-4,A,Gasket,1\n'), name: 'bom-rev-b.csv' });
  const dialog = jon.getByRole('dialog', { name: 'Compare with bom-rev-b.csv' });
  await expect(dialog).toContainText('2 changed · 1 new · 1 no longer listed');
  await expect(dialog).toContainText('quantity per assembly 2 → 3');
  await expect(dialog).toContainText('rev A → B');
  await expect(dialog.locator('section', { hasText: 'No longer in this list' })).toContainText('RV-3');
  await expect(jon.locator('table.parts tbody tr')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Update the parts to match' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await (await jon.request.get(`/api/quotes/${qid}`)).json()).lines.map((l: { partNumber: string; revision: string; qtyPer: number }) => `${l.partNumber} ${l.revision} x${l.qtyPer}`))
    .toEqual(['RV-1 A x3', 'RV-2 B x1', 'RV-4 A x1']);
  // Opened again from the file, it matches.
  await jon.locator('.file', { hasText: 'bom-rev-b.csv' }).getByRole('button', { name: 'Compare' }).click();
  await expect(jon.getByRole('dialog')).toContainText('the same parts as the quote');
});

test("the pricing panel lists the quote's drawings, the part's own first", async ({ browser }) => {
  const jon = await signIn(browser, 'jon');
  const qid = (await (await jon.request.post('/api/quotes', { data: {} })).json()).id;
  await jon.request.patch(`/api/quotes/${qid}`, { data: { customerName: 'Northfield Robotics', quantities: [50] } });
  await jon.request.put(`/api/quotes/${qid}/lines`, { data: { lines: [{ partNumber: 'NR-1210', revision: 'A', description: 'Housing, wrist', qtyPer: 1, notes: '', department: 'machining' }] } });
  const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n`);
  for (const name of ['Assembly overview.pdf', 'NR-1210_RevA.pdf', 'parts.csv']) {
    const body = name.endsWith('.csv') ? Buffer.from('Part Number,Qty\nNR-1210,1\n') : pdf(name);
    expect((await jon.request.post(`/api/quotes/${qid}/files?name=${encodeURIComponent(name)}`, { data: body, headers: { 'content-type': 'application/octet-stream' } })).status()).toBe(201);
  }
  expect((await jon.request.post(`/api/quotes/${qid}/send-to-estimating`, { data: {} })).status()).toBe(200);

  const mach = await signIn(browser, 'mach');
  await mach.goto(`/#/quotes/${qid}`);
  await mach.getByRole('button', { name: 'Price it' }).click();
  const drawings = mach.locator('.panel').getByRole('group', { name: 'Drawings' });
  await expect(drawings.locator('a')).toHaveText([/NR-1210_RevA\.pdfthis part/, /Assembly overview\.pdf/]);
  const own = drawings.locator('a.own');
  await expect(own).toHaveAttribute('target', '_blank');
  const res = await mach.request.get((await own.getAttribute('href')) as string);
  expect(res.headers()['content-type']).toContain('application/pdf');
});
