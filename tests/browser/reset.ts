// Resets TEST_DATABASE_URL for the browser tests and adds the people they sign in as. Refuses any
// database whose name does not end in _test.
import { loadConfig } from '../../src/server/config.ts';
import { createDatabase } from '../../src/server/db.ts';
import { assertSafeTarget, migrate } from '../../src/server/migrate.ts';
import { seedReference } from '../../src/persistence/reference.ts';
import { REFERENCE_SEED } from '../../src/pricing/seed.ts';
import { createAccount } from '../../src/persistence/accounts.ts';

export const PASSWORD = 'browser-test-1';
const config = loadConfig({ databaseUrlVar: 'TEST_DATABASE_URL' });
assertSafeTarget(config.database, false);
if (!config.database.database.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a *_test database.');
const db = createDatabase(config.database);
await db.exec('DROP SCHEMA IF EXISTS pricing CASCADE; DROP SCHEMA IF EXISTS quote CASCADE; DROP SCHEMA IF EXISTS app CASCADE;');
await migrate(db);
await seedReference(db, REFERENCE_SEED);
for (const [id, name, role, department] of [['jon', 'Jon Whitney', 'sales', null], ['chris', 'Chris Glaski', 'estimator', 'metals'], ['kevin', 'Kevin Bradley', 'estimator', 'procurement'], ['adc', 'ADC Estimator', 'estimator', 'molding']] as const) {
  await createAccount(db, null, { id, displayName: name, role, department, email: `${id}@mack.example`, password: PASSWORD, temporary: false });
}
await db.close();
