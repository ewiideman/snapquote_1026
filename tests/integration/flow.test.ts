// A quote from RFQ email to won, through the HTTP API, against TEST_DATABASE_URL (reset first).
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeQuotesFile } from '../../src/persistence/exchange.ts';

let db: Database;
let server: Server;
let base = '';
const exchangeDir = mkdtempSync(join(tmpdir(), 'sq-exchange-'));

before(async () => {
  const config = loadConfig({ databaseUrlVar: 'TEST_DATABASE_URL' });
  assertSafeTarget(config.database, false);
  if (!config.database.database.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a *_test database.');
  db = createDatabase(config.database);
  await db.exec('DROP SCHEMA IF EXISTS pricing CASCADE; DROP SCHEMA IF EXISTS quote CASCADE; DROP SCHEMA IF EXISTS app CASCADE;');
  await migrate(db);
  await seedReference(db, REFERENCE_SEED);
  const pw = 'correct horse';
  await createAccount(db, null, { id: 'jon.whitney', displayName: 'Jon Whitney', role: 'sales', email: 'jon.whitney@mack.com', password: pw, temporary: false });
  await createAccount(db, null, { id: 'metals.est', displayName: 'Metals Estimator', role: 'estimator', department: 'metals', password: pw, temporary: false });
  await createAccount(db, null, { id: 'buyer', displayName: 'Procurement Buyer', role: 'estimator', department: 'procurement', password: pw, temporary: false });
  server = createApp(db, { storageDir: mkdtempSync(join(tmpdir(), 'sq-files-')), exchangeDir }).listen(0);
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
  const call = async (method: string, path: string, payload?: unknown, raw?: Buffer) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(raw ? { 'content-type': 'application/octet-stream' } : payload !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: raw ? new Uint8Array(raw) : payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const type = r.headers.get('content-type') ?? '';
    const body = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, body: body as any, type };
  };
  return call;
}

function rfqEmail(): Buffer {
  const csv = 'Part Number,Rev,Description,Qty Per\n100-200,B,Mounting bracket,2\nPCB-77,,Controller board,1\n';
  return Buffer.from([
    'From: Jane Buyer <jane@acme-medical.com>',
    'To: jon.whitney@mack.com',
    'Subject: RFQ: Controller enclosure',
    'Date: Mon, 05 Oct 2026 09:30:00 -0400',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please quote 100 and 500 assemblies. Drawings attached.',
    '--b1',
    'Content-Type: text/csv; name="bom.csv"',
    'Content-Disposition: attachment; filename="bom.csv"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(csv).toString('base64'),
    '--b1--',
    '',
  ].join('\r\n'));
}

test('a quote from RFQ email to won', async () => {
  const jon = await session('jon.whitney');
  const metals = await session('metals.est');
  const buyer = await session('buyer');

  // Business development drops the RFQ email on a new quote.
  const created = await jon('POST', '/quotes', {});
  assert.equal(created.status, 201);
  const qid = created.body.id as number;
  const dropped = await jon('POST', `/quotes/${qid}/files?name=RFQ.eml`, undefined, rfqEmail());
  assert.equal(dropped.status, 201, JSON.stringify(dropped.body));
  assert.equal(dropped.body.fromEmail.subject, 'RFQ: Controller enclosure');
  assert.equal(dropped.body.linesAdded[0].lineIds.length, 2);
  let q = (await jon('GET', `/quotes/${qid}`)).body;
  assert.equal(q.quote.title, 'Controller enclosure');
  assert.equal(q.quote.contactEmail, 'jane@acme-medical.com');
  assert.equal(q.quote.rfqReceivedOn, '2026-10-05');
  assert.deepEqual(q.attachments.map((a: any) => a.fileName).sort(), ['RFQ.eml', 'bom.csv']);
  assert.equal(q.lines[0].qtyPer, 2);

  // It cannot go to the departments until the customer, quantities and departments are set.
  let r = await jon('POST', `/quotes/${qid}/send-to-estimating`, {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Name the customer/);
  await jon('PATCH', `/quotes/${qid}`, { customerName: 'Acme Medical', quantities: [500, 100], customerDueOn: '2026-10-20' });
  const lines = q.lines.map((l: any) => ({ id: l.id, partNumber: l.partNumber, revision: l.revision, description: l.description, qtyPer: l.qtyPer, notes: l.notes, department: l.partNumber === 'PCB-77' ? 'procurement' : 'metals' }));
  assert.equal((await jon('PUT', `/quotes/${qid}/lines`, { lines })).status, 200);
  r = await jon('POST', `/quotes/${qid}/send-to-estimating`, { neededBy: '2026-10-14' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  q = r.body;
  assert.equal(q.stage, 'estimating');
  assert.deepEqual(q.requests.map((x: any) => x.department).sort(), ['metals', 'procurement']);
  assert.deepEqual(q.lines[0].pieceQuantities, [200, 1000]);

  // The next email from that domain finds the customer.
  const second = (await jon('POST', '/quotes', {})).body.id;
  const d2 = await jon('POST', `/quotes/${second}/files?name=again.eml`, undefined, rfqEmail());
  assert.equal(d2.body.fromEmail.customerName, 'Acme Medical');

  // Each department sees it in its queue; an estimator cannot change the parts.
  const queue = (await metals('GET', '/queue/metals')).body;
  assert.equal(queue[0].number, q.quote.number);
  assert.equal(queue[0].lines, 1);
  assert.equal((await metals('PUT', `/quotes/${qid}/lines`, { lines })).status, 403);

  // Metals prices the bracket with the calculator.
  const bracket = q.lines.find((l: any) => l.partNumber === '100-200');
  const calcInput = {
    blank: { lengthMm: 120, widthMm: 80 },
    material: { itemNumber: 'SA0205048096' },
    operations: [{ name: 'Laser', workCell: 'L72', setupHours: 0.25, runMinutesPerPiece: 0.8 }, { name: 'Brake', workCell: 'Trumpf V85', setupHours: 0.5, runMinutesPerPiece: 0.5 }],
  };
  const catalog = (await metals('GET', '/metals/catalog')).body.catalog;
  assert.ok(catalog.workCells.length > 20);
  calcInput.operations = calcInput.operations.map((o) => ({ ...o, workCell: catalog.workCells.find((c: any) => c.name.includes(o.workCell.split(' ').pop()))?.name ?? catalog.workCells[0].name }));
  calcInput.material.itemNumber = catalog.materialItems.find((m: any) => m.priceUsd !== null).itemNumber;
  const preview = await metals('POST', `/lines/${bracket.id}/metals`, { input: calcInput });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.result.breaks.map((b: any) => b.parts), [200, 1000]);
  r = await metals('POST', `/quotes/${qid}/requests/metals/answer`, {});
  assert.equal(r.status, 400, 'cannot answer before pricing');
  assert.equal((await metals('POST', `/lines/${bracket.id}/metals`, { input: calcInput, save: true, leadTimeWeeks: 4 })).status, 200);
  assert.equal((await metals('POST', `/quotes/${qid}/requests/metals/answer`, {})).status, 200);

  // Procurement asks a question; business development's reply hands it back.
  r = await buyer('POST', `/quotes/${qid}/messages`, { body: 'Is the board RoHS?', department: 'procurement', question: true });
  assert.equal(r.body.requests.find((x: any) => x.department === 'procurement').status, 'question');
  assert.deepEqual((await jon('GET', '/board')).body.find((c: any) => c.id === qid).questionsFrom, ['procurement']);
  r = await jon('POST', `/quotes/${qid}/messages`, { body: 'Yes, RoHS.' });
  assert.equal(r.body.requests.find((x: any) => x.department === 'procurement').status, 'open');

  // Procurement prices the board from a vendor quote.
  const board = q.lines.find((l: any) => l.partNumber === 'PCB-77');
  const vq = await buyer('POST', `/lines/${board.id}/vendor-quotes`, { supplierName: 'Circuit Co', moq: 50, leadTimeWeeks: 6, nre: 300, prices: [{ quantity: 100, unitCost: 20 }, { quantity: 500, unitCost: 15 }] });
  assert.equal(vq.status, 201);
  assert.equal((await buyer('POST', `/lines/${board.id}/price-from-vendor`, { vendorQuoteId: vq.body.id, scrapPct: 0, freightPct: 0, markupPct: 20 })).status, 200);
  r = await buyer('POST', `/quotes/${qid}/requests/procurement/answer`, {});
  assert.equal(r.status, 200);
  q = r.body;
  assert.equal(q.stage, 'ready');
  assert.equal(q.sheet.complete, true);
  assert.equal(q.sheet.oneTimeTotal, 300);
  assert.equal(q.sheet.leadTimeWeeks, 6);
  const boardCell = q.sheet.lines.find((l: any) => l.lineId === board.id).cells;
  assert.deepEqual(boardCell.map((c: any) => c.unitPrice), [24, 18]);

  // Business development sets its own price at 500, with a reason, and the assembly price follows.
  r = await jon('PUT', `/lines/${board.id}/override`, { quantity: 500, unitPrice: 17.5 });
  assert.equal(r.status, 400, 'a reason is required');
  assert.equal((await jon('PUT', `/lines/${board.id}/override`, { quantity: 500, unitPrice: 17.5, reason: 'Volume commitment' })).status, 200);
  q = (await jon('GET', `/quotes/${qid}`)).body;
  const bracketCells = q.sheet.lines.find((l: any) => l.lineId === bracket.id).cells;
  assert.equal(q.sheet.assembly[1].unitPrice, Math.round((bracketCells[1].unitPrice * 2 + 17.5) * 10000) / 10000);

  // Changing a priced part hands the quote back to that department.
  const changed = q.lines.map((l: any) => ({ id: l.id, partNumber: l.partNumber, description: l.description, qtyPer: l.partNumber === '100-200' ? 3 : l.qtyPer, department: l.department }));
  q = (await jon('PUT', `/quotes/${qid}/lines`, { lines: changed })).body.quote;
  assert.equal(q.requests.find((x: any) => x.department === 'metals').status, 'open');
  assert.equal(q.stage, 'estimating');
  assert.equal((await metals('POST', `/lines/${bracket.id}/metals`, { input: calcInput, save: true, leadTimeWeeks: 4 })).status, 200);
  assert.equal((await metals('POST', `/quotes/${qid}/requests/metals/answer`, {})).status, 200);

  // The link to the Production Scheduler: Chris ties the work cells, the scheduler's capacity shows beside the quote.
  const [cellA, cellB] = calcInput.operations.map((o) => o.workCell) as [string, string];
  assert.equal((await jon('PUT', '/metals/facilities', { workCell: cellA, facilities: ['7/L72'] })).status, 403, 'business development does not tie work cells');
  assert.equal((await metals('PUT', '/metals/facilities', { workCell: cellA, facilities: ['7/L72'] })).status, 200);
  assert.equal((await metals('PUT', '/metals/facilities', { workCell: 'No such cell', facilities: [] })).status, 404);
  let cap = (await jon('GET', `/quotes/${qid}/capacity`)).body;
  assert.equal(cap.read.connected, true);
  assert.match(cap.read.problem, /not written its capacity file/);
  mkdirSync(join(exchangeDir, 'scheduler'), { recursive: true });
  writeFileSync(join(exchangeDir, 'scheduler', 'capacity.json'), JSON.stringify({
    format: 'mack.scheduler.capacity', version: 1, writtenAt: new Date().toISOString(), horizonWeeks: 12, basis: 'test',
    departments: [{ key: 'metals', label: 'Metals', asOf: new Date().toISOString(), scheduleName: 'Metals', facilities: [
      { code: '7/L72', name: 'FIBER LASER L72', efficiency: 0.85, hoursPerWeek: 120, lateHours: 30, nextSixWeeksHours: 600, load: 0.88, caughtUpWeek: 1 },
    ] }],
  }));
  cap = (await jon('GET', `/quotes/${qid}/capacity`)).body;
  const rowA = cap.rows.find((r: any) => r.workCell === cellA);
  const rowB = cap.rows.find((r: any) => r.workCell === cellB);
  // Three per assembly: 300 and 1,500 pieces. Setup 0.25 h once, 0.8 min a piece.
  assert.deepEqual(rowA.hours, [4.25, 20.25]);
  assert.equal(rowA.capacity.hoursPerWeek, 120);
  assert.equal(rowB.facilities, null, 'not tied yet');
  assert.equal(rowB.capacity, null);

  // The customer's copy, then sent, then won.
  const pdf = await jon('GET', `/quotes/${qid}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.type, 'application/pdf');
  assert.equal((pdf.body as Buffer).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await jon('POST', `/quotes/${qid}/close`, { outcome: 'won' })).status, 409, 'cannot win an unsent quote');
  assert.equal((await jon('POST', `/quotes/${qid}/sent`, {})).body.quote.status, 'sent');
  assert.equal((await jon('POST', `/quotes/${qid}/close`, { outcome: 'won', orderedQuantity: 250 })).status, 400, 'ordered quantity must be one quoted');
  q = (await jon('POST', `/quotes/${qid}/close`, { outcome: 'won', poNumber: 'PO-123', awardAmount: 25000, orderedQuantity: 500 })).body;
  assert.equal(q.quote.status, 'won');
  assert.equal(q.quote.orderedQuantity, 500);
  assert.equal(q.quote.poNumber, 'PO-123');
  const card = (await jon('GET', '/board')).body.find((c: any) => c.id === qid);
  assert.equal(card.stage, 'won');
  assert.equal(card.awardAmount, 25000);

  // What the scheduler is told: the won quote, its ordered quantity, hours per work cell and facility.
  await writeQuotesFile(db, exchangeDir);
  const out = JSON.parse(readFileSync(join(exchangeDir, 'snapquote', 'quotes.json'), 'utf8'));
  assert.equal(out.format, 'mack.snapquote.quotes');
  const won = out.quotes.find((x: any) => x.number === q.quote.number);
  assert.equal(won.status, 'won');
  assert.equal(won.orderedQuantity, 500);
  assert.deepEqual(won.quantities, [100, 500]);
  const laser = won.work.find((w: any) => w.workCell === cellA);
  assert.deepEqual(laser.facilities, ['7/L72']);
  assert.deepEqual(laser.pieces, [300, 1500]);
  assert.deepEqual(laser.hours, [4.25, 20.25]);
  assert.equal(won.work.find((w: any) => w.workCell === cellB).facilities, null);
  assert.ok(out.quotes.every((x: any) => x.status !== 'draft'), 'drafts are not news for the plant');
});

test('signed out, nothing but the session is reachable', async () => {
  assert.equal((await fetch(`${base}/board`)).status, 401);
  assert.equal((await fetch(`${base}/files/1`)).status, 401);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
