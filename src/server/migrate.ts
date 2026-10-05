// Migration runner with guards so it can only touch a database that belongs to this app.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './db.ts';
import type { DatabaseConfig } from './db.ts';
import { PROJECT_ROOT } from './config.ts';

export const APP_IDENTITY = 'snapquote-1026';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyError';
  }
}

/** Refuses non-local hosts (unless explicitly allowed) and databases not named for this app. */
export function assertSafeTarget(config: DatabaseConfig, allowNonLocal: boolean): void {
  if (!LOCAL_HOSTS.has(config.host) && !allowNonLocal) {
    throw new SafetyError(`Refusing to use non-local database host "${config.host}". Set ALLOW_NON_LOCAL_DATABASE=true only for an approved, non-production target.`);
  }
  if (!/^snapquote_1026(_[a-z0-9]+)*$/.test(config.database)) {
    throw new SafetyError(`Refusing to use database "${config.database}": name must start with "snapquote_1026" (for example snapquote_1026_dev). This keeps the old SnapQuote database, and any other, out of reach.`);
  }
}

export interface MigrationFile {
  version: string;
  file: string;
  sql: string;
  checksum: string;
}

export function listMigrations(dir = join(PROJECT_ROOT, 'migrations')): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), 'utf8');
      return { version: file.slice(0, 4), file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/** Ensures the database is empty or already marked as this app's database, then marks it. */
export async function claimDatabase(db: Database): Promise<void> {
  const identity = await db.query<{ exists: boolean }>(
    "SELECT to_regclass('app.database_identity') IS NOT NULL AS exists",
  );
  if (identity[0]?.exists) {
    const rows = await db.query<{ app_name: string }>('SELECT app_name FROM app.database_identity');
    if (rows[0]?.app_name !== APP_IDENTITY) {
      throw new SafetyError(`Database belongs to "${rows[0]?.app_name ?? 'unknown'}", not ${APP_IDENTITY}.`);
    }
    return;
  }
  const foreign = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'`,
  );
  if ((foreign[0]?.n ?? 0) > 0) {
    throw new SafetyError('Database already contains tables that were not created by this app. Use an empty database (see README).');
  }
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS app;
    CREATE TABLE app.database_identity (
      app_name   text PRIMARY KEY,
      claimed_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO app.database_identity (app_name) VALUES ('${APP_IDENTITY}');
    CREATE TABLE app.schema_migration (
      version    text PRIMARY KEY,
      file_name  text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function migrate(db: Database, log: (m: string) => void = () => undefined): Promise<string[]> {
  await claimDatabase(db);
  const applied = new Map(
    (await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM app.schema_migration')).map((r) => [r.version, r.checksum]),
  );
  const done: string[] = [];
  for (const m of listMigrations()) {
    const existing = applied.get(m.version);
    if (existing) {
      if (existing !== m.checksum) {
        throw new SafetyError(`Migration ${m.file} was modified after it was applied. Add a new migration instead of editing an applied one.`);
      }
      continue;
    }
    log(`applying ${m.file}`);
    try {
      await db.exec(`BEGIN;\n${m.sql}\n;INSERT INTO app.schema_migration (version, file_name, checksum) VALUES ('${m.version}', '${m.file}', '${m.checksum}');\nCOMMIT;`);
    } catch (err) {
      // Database.exec rolls back on the same connection before releasing it.
      throw new Error(`Migration ${m.file} failed: ${(err as Error).message}`);
    }
    done.push(m.file);
  }
  return done;
}
