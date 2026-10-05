// Applies pending migrations to DATABASE_URL (or TEST_DATABASE_URL with --test), then adds any
// calculator reference data the database does not have yet. It never overwrites a changed rate.
import { parseArgs } from 'node:util';
import { loadConfig } from '../server/config.ts';
import { createDatabase } from '../server/db.ts';
import { assertSafeTarget, migrate } from '../server/migrate.ts';
import { seedReference } from '../persistence/reference.ts';
import { REFERENCE_SEED } from '../pricing/seed.ts';
import { runCli } from './common.ts';

await runCli(async () => {
  const { values } = parseArgs({ options: { test: { type: 'boolean', default: false } } });
  const config = loadConfig({ databaseUrlVar: values.test ? 'TEST_DATABASE_URL' : 'DATABASE_URL' });
  assertSafeTarget(config.database, config.allowNonLocalDatabase);
  console.log(`Database: ${config.databaseUrlRedacted}`);
  const db = createDatabase(config.database);
  try {
    const applied = await migrate(db, (m) => console.log(`  ${m}`));
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Already up to date.');
    const seeded = await seedReference(db, REFERENCE_SEED);
    if (seeded) console.log(`Added ${seeded} reference row(s) for the calculators.`);
  } finally {
    await db.close();
  }
});
