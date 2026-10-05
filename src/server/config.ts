// Configuration from environment variables, with an optional project-root .env file.
// Real environment variables win over .env values. No secrets have defaults. Everything runs on
// Mack's own server: the database, the files and the app itself. Nothing is sent anywhere else.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDatabaseUrl, type DatabaseConfig } from './db.ts';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface AppConfig {
  database: DatabaseConfig;
  databaseUrlRedacted: string;
  allowNonLocalDatabase: boolean;
  host: string;
  port: number;
  /** How long a sign-in lasts (SESSION_HOURS). A week by default. */
  sessionHours: number;
  /** STORAGE_DIR: where attached files are kept. ./storage by default. */
  storageDir: string;
  /** SMTP_HOST (with SMTP_PORT, SMTP_FROM, SMTP_USER, SMTP_PASSWORD): Mack's mail relay for quote emails; null sends none. */
  mail: { host: string; port: number; from: string; user: string | null; password: string | null } | null;
  /** APP_URL: the address people open SnapQuote at, for links in emails, e.g. http://mack-server:3200. */
  appUrl: string | null;
  /** MACK_EXCHANGE_DIR: the folder SnapQuote and the Production Scheduler exchange files in; null, no exchange. */
  exchangeDir: string | null;
}

export function loadDotEnv(file = join(PROJECT_ROOT, '.env')): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2] as string;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1] as string] = value;
  }
  return out;
}

function sessionHoursFrom(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 168;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 24 * 90) throw new Error(`SESSION_HOURS must be a whole number of hours from 1 to ${24 * 90}; it is "${raw}".`);
  return n;
}

function mailFrom(env: Record<string, string | undefined>): AppConfig['mail'] {
  const host = env['SMTP_HOST']?.trim();
  if (!host) return null;
  const port = Number(env['SMTP_PORT'] ?? 25);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`SMTP_PORT must be a port number, not "${env['SMTP_PORT']}".`);
  return { host, port, from: env['SMTP_FROM']?.trim() || 'snapquote@mack.com', user: env['SMTP_USER']?.trim() || null, password: env['SMTP_PASSWORD'] ?? null };
}

export function loadConfig(overrides: { databaseUrlVar?: string } = {}): AppConfig {
  const env = { ...loadDotEnv(), ...process.env };
  const varName = overrides.databaseUrlVar ?? 'DATABASE_URL';
  const url = env[varName];
  if (!url) throw new Error(`${varName} is not set. Copy .env.example to .env (see README).`);
  const storage = env['STORAGE_DIR']?.trim() || 'storage';
  return {
    database: { ...parseDatabaseUrl(url), maxConnections: Number(env['DB_MAX_CONNECTIONS'] ?? 5) },
    databaseUrlRedacted: url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@'),
    allowNonLocalDatabase: env['ALLOW_NON_LOCAL_DATABASE'] === 'true',
    host: env['HOST'] ?? '127.0.0.1',
    port: Number(env['PORT'] ?? 3200),
    sessionHours: sessionHoursFrom(env['SESSION_HOURS']),
    storageDir: isAbsolute(storage) ? storage : join(PROJECT_ROOT, storage),
    exchangeDir: env['MACK_EXCHANGE_DIR']?.trim() || null,
    mail: mailFrom(env),
    appUrl: env['APP_URL']?.trim() || null,
  };
}
