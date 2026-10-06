// Customers and suppliers from the old SnapQuote's exported files, against TEST_DATABASE_URL (reset first).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/server/config.ts';
import { createDatabase, type Database } from '../../src/server/db.ts';
import { assertSafeTarget, migrate } from '../../src/server/migrate.ts';
import { applyDirectoryImport, planFromFile } from '../../src/persistence/directory.ts';
import { customerForEmail } from '../../src/persistence/quotes.ts';

let db: Database;
const dir = mkdtempSync(join(tmpdir(), 'sq-directory-'));

before(async () => {
  const config = loadConfig({ databaseUrlVar: 'TEST_DATABASE_URL' });
  assertSafeTarget(config.database, false);
  if (!config.database.database.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a *_test database.');
  db = createDatabase(config.database);
  await db.exec('DROP SCHEMA IF EXISTS pricing CASCADE; DROP SCHEMA IF EXISTS quote CASCADE; DROP SCHEMA IF EXISTS app CASCADE;');
  await migrate(db);
});

after(async () => {
  await db?.close();
});

test('a dry run changes nothing; --apply adds once; a second run adds nothing more', async () => {
  await db.query("INSERT INTO quote.customer (name) VALUES ('Stryker')");
  const customers = join(dir, 'customers.csv');
  // Windows-1252, as psql on Windows may write it: "Hôpital" must survive.
  writeFileSync(customers, Buffer.from('id,name,email,city\r\n1,Acme Medical,jane@acme-medical.com,Bennington\r\n2,STRYKER,,\r\n3,H\xf4pital Supply,,Montr\xe9al\r\n', 'latin1'));
  const suppliers = join(dir, 'suppliers.csv');
  writeFileSync(suppliers, 'id,name,category,payment_terms\n9,Circuit Co,PCB,Net 30\n');

  const dry = await planFromFile(db, 'customer', customers);
  assert.deepEqual(dry.add.map((e) => e.name), ['Acme Medical', 'Hôpital Supply']);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM quote.customer'))[0]?.n, 1, 'the dry run wrote nothing');

  await applyDirectoryImport(db, null, 'customer', customers);
  await applyDirectoryImport(db, null, 'supplier', suppliers);
  const rows = await db.query<{ name: string; email_domains: string[]; imported: { rows: Record<string, string>[] } | null }>('SELECT name, email_domains, imported FROM quote.customer ORDER BY name');
  assert.deepEqual(rows.map((r) => r.name), ['Acme Medical', 'Hôpital Supply', 'Stryker']);
  assert.equal(rows[1]?.imported?.rows[0]?.['city'], 'Montréal');
  assert.equal(rows[2]?.imported, null, 'one added here is untouched');
  assert.deepEqual(await customerForEmail(db, 'someone.else@acme-medical.com'), { id: (await db.query<{ id: number }>("SELECT id FROM quote.customer WHERE name = 'Acme Medical'"))[0]?.id, name: 'Acme Medical' }, 'their next RFQ email is recognized');
  const supplier = (await db.query<{ name: string; imported: { rows: Record<string, string>[] } }>('SELECT name, imported FROM quote.supplier'))[0];
  assert.equal(supplier?.imported.rows[0]?.['payment_terms'], 'Net 30');

  const again = await applyDirectoryImport(db, null, 'customer', customers);
  assert.equal(again.add.length, 0);
  assert.deepEqual(again.alreadyHere, ['Acme Medical', 'Hôpital Supply', 'Stryker']);
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM app.audit_event WHERE action = 'directory.imported'"))[0]?.n, 3);
});
