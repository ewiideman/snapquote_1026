// Database access boundary backed by the `pg` driver. Application code depends only on
// the Database / Queryable interfaces below.
import pg from 'pg';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Database extends Queryable {
  /** Runs fn inside BEGIN/COMMIT on one connection; rolls back on error. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Multi-statement SQL without parameters (migrations only). Rolls back an open transaction on error. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export interface ConnectionOptions {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

export interface DatabaseConfig extends ConnectionOptions {
  maxConnections?: number;
}

export function parseDatabaseUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('DATABASE_URL must start with postgres://');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must include a database name');
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username || 'postgres'),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    database,
  };
}

// Value conventions kept stable for the rest of the application (and independent of the
// machine's time zone): numeric and date stay strings, int8 becomes a number when safe,
// timestamps become ISO-8601 UTC strings, json/jsonb and arrays are parsed by pg.
const OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 } as const;

export function toIsoTimestamp(text: string, withZone: boolean): string {
  const normalized = text.replace(' ', 'T');
  const zoned = withZone ? normalized.replace(/([+-]\d\d)$/, '$1:00') : `${normalized}Z`;
  return new Date(zoned).toISOString();
}

export const typeParsers = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    switch (oid) {
      case OID.INT8:
        return (v: string) => (Number.isSafeInteger(Number(v)) ? Number(v) : v);
      case OID.NUMERIC:
      case OID.DATE:
        return (v: string) => v;
      case OID.TIMESTAMPTZ:
        return (v: string) => toIsoTimestamp(v, true);
      case OID.TIMESTAMP:
        return (v: string) => toIsoTimestamp(v, false);
      default:
        return format === 'binary' ? pg.types.getTypeParser(oid, 'binary') : pg.types.getTypeParser(oid, 'text');
    }
  },
};

export function createDatabase(config: DatabaseConfig): Database {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    ...(config.password !== undefined ? { password: config.password } : {}),
    database: config.database,
    max: config.maxConnections ?? 5,
    application_name: 'snapquote',
    options: '-c TimeZone=UTC',
    types: typeParsers as pg.CustomTypesConfig,
  });
  // Idle client errors (e.g. server restart) must not crash the process.
  pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));

  return {
    async query<T extends Row = Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await pool.query(sql, params as unknown[]);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Queryable = {
          query: async <R extends Row = Row>(sql: string, params: readonly unknown[] = []) => (await client.query(sql, params as unknown[])).rows as R[],
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(sql: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query(sql); // no parameters → simple protocol, multiple statements allowed
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
