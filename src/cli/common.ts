import { loadConfig } from '../server/config.ts';
import { createDatabase, type Database } from '../server/db.ts';
import { assertSafeTarget, listMigrations, SafetyError } from '../server/migrate.ts';

export async function openDatabase(options: { requireMigrated?: boolean; databaseUrlVar?: string } = {}): Promise<Database> {
  const config = loadConfig({ databaseUrlVar: options.databaseUrlVar ?? 'DATABASE_URL' });
  assertSafeTarget(config.database, config.allowNonLocalDatabase);
  const db = createDatabase(config.database);
  if (options.requireMigrated !== false) {
    const hasTable = await db.query<{ ok: boolean }>("SELECT to_regclass('app.schema_migration') IS NOT NULL AS ok");
    const applied = hasTable[0]?.ok ? (await db.query<{ version: string }>('SELECT version FROM app.schema_migration')).map((r) => r.version) : [];
    const pending = listMigrations().filter((m) => !applied.includes(m.version));
    if (pending.length) {
      await db.close();
      throw new SafetyError(`Database has pending migrations (${pending.map((m) => m.file).join(', ')}). Run: npm run db:migrate`);
    }
  }
  return db;
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    const e = err as Error;
    console.error(`\n✖ ${e.name === 'Error' ? '' : `${e.name}: `}${e.message}`);
    process.exitCode = 1;
  }
}
