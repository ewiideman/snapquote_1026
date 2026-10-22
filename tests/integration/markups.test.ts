// Business development's adjustment to every price on a quote, and the departments' markups under
// Settings, through the HTTP API against TEST_DATABASE_URL (reset first).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { loadConfig } from '../../src/server/config.ts';
import { createDatabase, type Database } from '../../src/server/db.ts';
import { assertSafeTarget, migrate } from '../../src/server/migrate.ts';
import { seedReference } from '../../src/persistence/reference.ts';
import { REFERENCE_SEED } from '../../src/pricing/seed.ts';
import { createAccount } from '../../src/persistence/accounts.ts';
import { createApp } from '../../src/server/app.ts';
import { parseMetalsCalculationSettings } from '../../src/pricing/metals/index.ts';

let db: Database;
let server: Server;
let base = '';

before(async () => {
  const config = loadConfig({ databaseUrlVar: 'TEST_DATABASE_URL' });
  assertSafeTarget(config.database, false);
  if (!config.database.database.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a *_test database.');
  db = createDatabase(config.database);
  await db.exec('DROP SCHEMA IF EXISTS pricing CASCADE; DROP SCHEMA IF EXISTS quote CASCADE; DROP SCHEMA IF EXISTS app CASCADE;');
  await migrate(db);
  await seedReference(db, REFERENCE_SEED);
  for (const [id, role, department] of [['jon', 'sales', null], ['admin', 'administrator', null], ['buyer', 'estimator', 'procurement']] as const) {
    await createAccount(db, null, { id, displayName: id, role, department, password: 'correct horse', temporary: false });
  }
  server = createApp(db, { storageDir: mkdtempSync(join(tmpdir(), 'sq-files-')), exchangeDir: null }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
});

after(async () => {
  server?.close();
  await db?.close();
});

async function session(id: string) {
  const res = await fetch(`${base}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, password: 'correct horse' }) });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] as string;
  return async (method: string, path: string, payload?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, body: payload !== undefined ? JSON.stringify(payload) : undefined });
    return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : null as any };
  };
}

test('an adjustment moves every price on the quote, follows a changed estimate, and comes off again', async () => {
  const jon = await session('jon');
  const buyer = await session('buyer');
  const q = (await jon('POST', '/quotes', {})).body;
  await jon('PATCH', `/quotes/${q.id}`, { customerName: 'Locus Robotics', quantities: [100] });
  await jon('PUT', `/quotes/${q.id}/lines`, { lines: [
    { partNumber: 'HW-1', description: 'Screw', qtyPer: 4, department: 'procurement' },
    { partNumber: 'HW-2', description: 'Nut', qtyPer: 1, department: 'procurement' },
  ] });
  assert.equal((await jon('POST', `/quotes/${q.id}/send-to-estimating`, {})).status, 200);
  const lines = (await jon('GET', `/quotes/${q.id}`)).body.lines;
  const price = (l: any, p: number) => buyer('PUT', `/lines/${l.id}/estimate`, { basis: 'manual', prices: l.pieceQuantities.map((n: number) => ({ quantity: n, unitPrice: p })) });
  await price(lines[0], 1);
  await price(lines[1], 2);

  assert.equal((await jon('PUT', `/quotes/${q.id}/adjustment`, { percent: 10 })).status, 400, 'a reason is needed');
  assert.equal((await jon('PUT', `/quotes/${q.id}/adjustment`, { percent: 0, reason: 'x' })).status, 400);
  assert.equal((await jon('PUT', `/quotes/${q.id}/adjustment`, { percent: -100, reason: 'x' })).status, 400);
  assert.equal((await buyer('PUT', `/quotes/${q.id}/adjustment`, { percent: 10, reason: 'x' })).status, 403);

  let d = (await jon('PUT', `/quotes/${q.id}/adjustment`, { percent: 10, reason: 'Target margin' })).body;
  assert.deepEqual([d.quote.adjustment.pct, d.quote.adjustment.reason, d.quote.adjustment.setByName], [10, 'Target margin', 'jon']);
  assert.deepEqual(d.sheet.lines.map((l: any) => l.cells[0].unitPrice), [1.1, 2.2]);
  assert.equal(d.sheet.assembly[0].unitPrice, 6.6);
  assert.ok(d.messages.some((m: any) => m.body.includes("set every price to the departments' +10%: Target margin")));

  // A part's own price wins; a department's new price is adjusted too.
  await jon('PUT', `/lines/${lines[1].id}/override`, { quantity: 100, unitPrice: 2, reason: 'Hold last price' });
  await price(lines[0], 3);
  d = (await jon('GET', `/quotes/${q.id}`)).body;
  assert.deepEqual(d.sheet.lines.map((l: any) => l.cells[0].unitPrice), [3.3, 2]);

  d = (await jon('PUT', `/quotes/${q.id}/adjustment`, { percent: null })).body;
  assert.equal(d.quote.adjustment, null);
  assert.deepEqual(d.sheet.lines.map((l: any) => l.cells[0].unitPrice), [3, 2]);
  const audit = await db.query<{ n: string }>("SELECT count(*) AS n FROM app.audit_event WHERE action = 'quote.adjusted'");
  assert.equal(Number(audit[0]?.n), 2);

  await jon('POST', `/quotes/${q.id}/sent`, {});
  assert.equal((await jon('PUT', `/quotes/${q.id}/adjustment`, { percent: 5, reason: 'late' })).status, 409, 'a sent quote is revised first');
});

test("markups: an administrator changes one figure, the rest of the department's settings are kept", async () => {
  const admin = await session('admin');
  const jon = await session('jon');
  const metals = () => admin('GET', '/markups').then((r) => r.body.find((g: any) => g.department === 'metals'));
  const before = await metals();
  assert.deepEqual(before.fields.map((f: any) => [f.key, f.pct, f.importedPct]), [['materialMarkup', 20, 20], ['ospMarkupPct', 20, 20], ['ospFreightPct', 11, 11]]);
  assert.equal(before.updatedByName, null);

  assert.equal((await jon('PUT', '/markups/metals/materialMarkup', { pct: 25 })).status, 403);
  assert.equal((await admin('PUT', '/markups/metals/ospMarkupPct', { pct: 150 })).status, 400, 'Metals reads a fraction over 1 as a percent');
  assert.equal((await admin('PUT', '/markups/molding/materialScrap', { pct: 100 })).status, 400);
  assert.equal((await admin('PUT', '/markups/metals/nestWebIn', { pct: 1 })).status, 404, 'only markups are set here');

  assert.equal((await admin('PUT', '/markups/metals/materialMarkup', { pct: 25 })).status, 200);
  assert.equal((await admin('PUT', '/markups/metals/ospFreightPct', { pct: 8 })).status, 200);
  const after = await metals();
  assert.deepEqual(after.fields.map((f: any) => [f.pct, f.importedPct]), [[25, 20], [20, 20], [8, 11]]);
  assert.equal(after.updatedByName, 'admin');
  const row = await db.query<{ data: unknown }>("SELECT data FROM pricing.reference WHERE department = 'metals' AND kind = 'setting' AND key = 'calculation'");
  assert.deepEqual(row[0]?.data, { materialMarkup: 1.25, ospFreightPct: 0.08 });
  const parsed = parseMetalsCalculationSettings(row[0]?.data);
  assert.deepEqual([parsed?.materialMarkup, parsed?.ospFreightPct], [1.25, 0.08]);

  assert.equal((await admin('PUT', '/markups/machining/rawMaterialMarkup', { pct: 30 })).status, 200);
  const mach = (await admin('GET', '/markups')).body.find((g: any) => g.department === 'machining');
  assert.equal(mach.fields.find((f: any) => f.key === 'rawMaterialMarkup').pct, 30);
});
