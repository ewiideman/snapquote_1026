// Accounts, passwords and sessions. Every change is made by whoever is signed in; nothing in a request
// can name someone else. Passwords are stored only as salted scrypt hashes, sessions only as the
// SHA-256 of a random token, so neither table lets a reader sign in.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Database, Queryable } from '../server/db.ts';
import { isDepartment, type DepartmentKey } from '../quoting/departments.ts';
import { audit, HttpError, sha256 } from './util.ts';

export const ROLES = ['sales', 'estimator', 'manager', 'administrator'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_NAMES: Record<Role, string> = { sales: 'Business development', estimator: 'Estimator', manager: 'Manager', administrator: 'Administrator' };

// ---------------------------------------------------------------- passwords (pure)

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 } as const;
export const PASSWORD_MIN_LENGTH = 8;

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  const options: ScryptOptions = { N, r, p, maxmem: 128 * N * r * 2 };
  return new Promise((resolve, reject) => scrypt(password.normalize('NFC'), salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Why a password cannot be used, or null. Length only: a rule list makes people write passwords down. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `A password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return 'A password may be at most 200 characters.';
  if (!password.trim()) return 'A password cannot be only spaces.';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || expected.length === 0) return false;
  return timingSafeEqual(await derive(password, salt, N, r, p, expected.length), expected);
}

// A wrong user name takes as long to refuse as a wrong password.
let decoyHash: Promise<string> | null = null;
const decoy = () => (decoyHash ??= hashPassword(randomBytes(12).toString('base64')));

// ---------------------------------------------------------------- accounts

export interface Account {
  id: string;
  displayName: string;
  role: Role;
  department: DepartmentKey | null;
  email: string | null;
  mustChangePassword: boolean;
}

type AccountRow = {
  id: string; display_name: string; role: Role; department: DepartmentKey | null; email: string | null;
  must_change_password: boolean; password_hash: string | null; disabled_at: string | null;
};
const COLUMNS = 'id, display_name, role, department, email, must_change_password, password_hash, disabled_at';
const toAccount = (r: AccountRow): Account => ({ id: r.id, displayName: r.display_name, role: r.role, department: r.department, email: r.email, mustChangePassword: r.must_change_password });

async function accountRow(db: Queryable, id: string): Promise<AccountRow | undefined> {
  return (await db.query<AccountRow>(`SELECT ${COLUMNS} FROM app.user_account WHERE id = $1`, [id]))[0];
}

export function accountIdProblem(id: string): string | null {
  return /^[a-z0-9][a-z0-9._-]{1,62}$/.test(id) ? null : 'A username is 2 to 63 characters: lower-case letters, digits, dots, hyphens and underscores (for example jon.whitney).';
}

function requireRole(role: unknown): Role {
  if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) throw new HttpError(400, `role must be one of ${ROLES.join(', ')}`);
  return role as Role;
}

function requireDepartmentFor(role: Role, department: unknown): DepartmentKey | null {
  if (department === null || department === undefined || department === '') {
    if (role === 'estimator') throw new HttpError(400, 'An estimator needs a department.');
    return null;
  }
  if (!isDepartment(department)) throw new HttpError(400, 'Unknown department.');
  return department;
}

function requirePassword(secret: unknown): string {
  if (typeof secret !== 'string') throw new HttpError(400, 'password is required');
  const problem = passwordProblem(secret);
  if (problem) throw new HttpError(400, problem);
  return secret;
}

// ---------------------------------------------------------------- sessions

export const SESSION_COOKIE = 'snapquote_session';

export interface SignedIn { token: string; expiresAt: string; account: Account }

export async function signIn(db: Database, input: { id: unknown; password: unknown; sessionHours: number }): Promise<SignedIn> {
  const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const refused = new HttpError(401, 'That username and password do not match an account that can sign in.');
  const row = id ? await accountRow(db, id) : undefined;
  if (!row || !row.password_hash || row.disabled_at) {
    await verifyPassword(password, await decoy());
    throw refused;
  }
  if (!(await verifyPassword(password, row.password_hash))) {
    await audit(db, null, 'session.sign_in_refused', 'user_account', row.id, { reason: 'wrong password' });
    throw refused;
  }
  const token = randomBytes(32).toString('base64url');
  const expires = await db.query<{ expires_at: string }>(
    'INSERT INTO app.session (token_sha256, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING expires_at',
    [sha256(token), row.id, input.sessionHours]);
  await audit(db, row.id, 'session.signed_in', 'user_account', row.id);
  return { token, expiresAt: expires[0]?.expires_at as string, account: toAccount(row) };
}

export async function sessionAccount(db: Queryable, token: string): Promise<Account | null> {
  const rows = await db.query<AccountRow>(
    `SELECT u.${COLUMNS.split(', ').join(', u.')}
       FROM app.session s JOIN app.user_account u ON u.id = s.user_id
      WHERE s.token_sha256 = $1 AND s.ended_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL AND u.password_hash IS NOT NULL`,
    [sha256(token)]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function signOut(db: Queryable, token: string): Promise<void> {
  await db.query("UPDATE app.session SET ended_at = now(), ended_reason = 'signed out' WHERE token_sha256 = $1 AND ended_at IS NULL", [sha256(token)]);
}

export async function changeOwnPassword(db: Database, input: { userId: string; token: string; currentPassword: unknown; newPassword: unknown }): Promise<void> {
  const row = await accountRow(db, input.userId);
  if (!row?.password_hash) throw new HttpError(401, 'Sign in first.');
  if (typeof input.currentPassword !== 'string' || !(await verifyPassword(input.currentPassword, row.password_hash))) throw new HttpError(400, 'The current password is not right.');
  const next = requirePassword(input.newPassword);
  if (next === input.currentPassword) throw new HttpError(400, 'The new password must be different from the current one.');
  const hash = await hashPassword(next);
  await db.transaction(async (tx) => {
    await tx.query('UPDATE app.user_account SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1', [row.id, hash]);
    await tx.query("UPDATE app.session SET ended_at = now(), ended_reason = 'password changed' WHERE user_id = $1 AND ended_at IS NULL AND token_sha256 <> $2", [row.id, sha256(input.token)]);
    await audit(tx, row.id, 'user_account.password_changed', 'user_account', row.id, { by: 'self' });
  });
}

// ---------------------------------------------------------------- administration

export interface AccountListing extends Account { canSignIn: boolean; disabledAt: string | null; lastSignedInAt: string | null }

export async function listAccounts(db: Queryable): Promise<AccountListing[]> {
  const rows = await db.query<AccountRow & { last_signed_in_at: string | null }>(
    `SELECT ${COLUMNS}, (SELECT max(s.created_at) FROM app.session s WHERE s.user_id = u.id) AS last_signed_in_at
       FROM app.user_account u ORDER BY disabled_at IS NOT NULL, display_name`);
  return rows.map((r) => ({ ...toAccount(r), canSignIn: !!r.password_hash && !r.disabled_at, disabledAt: r.disabled_at, lastSignedInAt: r.last_signed_in_at }));
}

/** Everyone who can be named on a quote (owner, assignee), for pick lists. */
export async function listPeople(db: Queryable): Promise<{ id: string; displayName: string; role: Role; department: DepartmentKey | null }[]> {
  const rows = await db.query<AccountRow>(`SELECT ${COLUMNS} FROM app.user_account WHERE disabled_at IS NULL ORDER BY display_name`);
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, role: r.role, department: r.department }));
}

export async function createAccount(db: Database, actor: string | null, input: { id: unknown; displayName: unknown; role: unknown; department?: unknown; email?: unknown; password: unknown; temporary?: boolean }): Promise<Account> {
  const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
  const idProblem = accountIdProblem(id);
  if (idProblem) throw new HttpError(400, idProblem);
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (!displayName) throw new HttpError(400, 'A name is required.');
  const role = requireRole(input.role);
  const department = requireDepartmentFor(role, input.department);
  const email = typeof input.email === 'string' && input.email.trim() ? input.email.trim() : null;
  const hash = await hashPassword(requirePassword(input.password));
  const temporary = input.temporary ?? actor !== null;
  return db.transaction(async (tx) => {
    if (await accountRow(tx, id)) throw new HttpError(409, `There is already an account "${id}".`);
    await tx.query(
      'INSERT INTO app.user_account (id, display_name, role, department, email, password_hash, must_change_password, password_changed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
      [id, displayName, role, department, email, hash, temporary]);
    await audit(tx, actor, 'user_account.created', 'user_account', id, { role, department });
    return toAccount((await accountRow(tx, id)) as AccountRow);
  });
}

export async function updateAccount(db: Database, actor: string, id: string, input: { displayName?: unknown; role?: unknown; department?: unknown; email?: unknown; disabled?: unknown; password?: unknown }): Promise<void> {
  const row = await accountRow(db, id);
  if (!row) throw new HttpError(404, 'No such account.');
  const role = input.role === undefined ? row.role : requireRole(input.role);
  const department = input.department === undefined && input.role === undefined ? row.department : requireDepartmentFor(role, input.department === undefined ? row.department : input.department);
  if (id === actor && (role !== row.role || input.disabled === true)) throw new HttpError(400, 'You cannot change your own role or disable yourself.');
  const hash = input.password === undefined ? null : await hashPassword(requirePassword(input.password));
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE app.user_account SET display_name = coalesce($2, display_name), role = $3, department = $4, email = CASE WHEN $5::boolean THEN $6 ELSE email END,
              disabled_at = CASE WHEN $7::boolean IS NULL THEN disabled_at WHEN $7 THEN coalesce(disabled_at, now()) ELSE NULL END,
              password_hash = coalesce($8, password_hash), must_change_password = CASE WHEN $8 IS NULL THEN must_change_password ELSE true END,
              password_changed_at = CASE WHEN $8 IS NULL THEN password_changed_at ELSE now() END
        WHERE id = $1`,
      [id, typeof input.displayName === 'string' && input.displayName.trim() ? input.displayName.trim() : null, role, department,
        input.email !== undefined, typeof input.email === 'string' && input.email.trim() ? input.email.trim() : null,
        typeof input.disabled === 'boolean' ? input.disabled : null, hash]);
    if (input.disabled === true || hash) await tx.query("UPDATE app.session SET ended_at = now(), ended_reason = 'changed by administrator' WHERE user_id = $1 AND ended_at IS NULL", [id]);
    await audit(tx, actor, 'user_account.updated', 'user_account', id, { role, department, disabled: input.disabled, passwordSet: !!hash });
  });
}

export async function administratorCanSignIn(db: Queryable): Promise<boolean> {
  const rows = await db.query("SELECT 1 FROM app.user_account WHERE role = 'administrator' AND password_hash IS NOT NULL AND disabled_at IS NULL LIMIT 1");
  return rows.length > 0;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : null;
  }
  return null;
}

export function sessionCookie(token: string, opts: { maxAgeSeconds: number; secure: boolean }): string {
  return [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`, ...(opts.secure ? ['Secure'] : [])].join('; ');
}
