// Light, dark and the computer's own setting: chosen in the sidebar or on the account page, remembered
// in the browser, and applied before the app's code loads, so a dark page never flashes light.
import { test, expect, type Page } from '@playwright/test';

const PASSWORD = 'browser-test-1';
const theme = (page: Page) => page.locator('html').getAttribute('data-theme');

async function signIn(page: Page, id: string) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.getByLabel('Username').fill(id);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test('the theme is chosen, remembered, applied before the app loads, and can follow the computer', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await signIn(page, 'jon');
  expect(await theme(page)).toBe('light');

  // Dark, from the sidebar.
  await page.locator('.theme.top').getByRole('button', { name: /^Theme/ }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  expect(await theme(page)).toBe('dark');
  const bg = await page.locator('body').evaluate((e) => e.ownerDocument.defaultView!.getComputedStyle(e).backgroundColor);
  expect(bg).toBe('rgb(19, 22, 27)');

  // Remembered, and on before any of the app's code runs: the page is dark with its script blocked.
  await page.route('**/assets/*.js', (r) => r.abort());
  await page.reload();
  expect(await theme(page)).toBe('dark');
  expect(await page.locator('html').evaluate((e) => e.ownerDocument.defaultView!.getComputedStyle(e).backgroundColor)).toBe('rgb(19, 22, 27)');
  await page.unroute('**/assets/*.js');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  expect(await theme(page)).toBe('dark');

  // On the account page: follow the computer, which changes while the page is open.
  await page.goto('/#/account');
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }).click();
  expect(await theme(page)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => theme(page)).toBe('light');
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  expect(await theme(page), 'a chosen theme wins over the computer').toBe('light');
  await context.close();
});
