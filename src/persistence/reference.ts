// Reference data the calculators read (work cells, materials, rates) and the quote's own settings
// (the terms printed on the customer's copy). Administrators change them; every change is audited.
import type { Database, Queryable } from '../server/db.ts';
import type { Account } from './accounts.ts';
import { audit, HttpError } from './util.ts';

export interface ReferenceRow { department: string; kind: string; key: string; data: unknown; active: boolean; updatedAt: string; updatedByName: string | null }

export async function referenceRows(db: Queryable, department: string, kind?: string): Promise<ReferenceRow[]> {
  const rows = await db.query<{ department: string; kind: string; key: string; data: unknown; active: boolean; updated_at: string; updated_by_name: string | null }>(
    `SELECT r.department, r.kind, r.key, r.data, r.active, r.updated_at, u.display_name AS updated_by_name
       FROM pricing.reference r LEFT JOIN app.user_account u ON u.id = r.updated_by
      WHERE r.department = $1 AND ($2::text IS NULL OR r.kind = $2) ORDER BY r.kind, r.key`, [department, kind ?? null]);
  return rows.map((r) => ({ department: r.department, kind: r.kind, key: r.key, data: r.data, active: r.active, updatedAt: r.updated_at, updatedByName: r.updated_by_name }));
}

export async function setReference(db: Database, actor: Account | null, input: { department: string; kind: string; key: string; data: unknown; active?: boolean }): Promise<void> {
  if (actor && actor.role !== 'administrator') throw new HttpError(403, 'Only administrators change rates and settings.');
  if (!/^[a-z_]{2,40}$/.test(input.department) || !/^[a-z_]{2,40}$/.test(input.kind)) throw new HttpError(400, 'Bad department or kind.');
  if (typeof input.key !== 'string' || !input.key.trim() || input.key.length > 120) throw new HttpError(400, 'A key is required.');
  if (input.data === undefined || input.data === null || typeof input.data !== 'object') throw new HttpError(400, 'data must be an object.');
  await db.transaction(async (tx) => {
    const before = await tx.query<{ data: unknown }>('SELECT data FROM pricing.reference WHERE department = $1 AND kind = $2 AND key = $3', [input.department, input.kind, input.key]);
    await tx.query(
      `INSERT INTO pricing.reference (department, kind, key, data, active, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (department, kind, key) DO UPDATE SET data = EXCLUDED.data, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [input.department, input.kind, input.key.trim(), JSON.stringify(input.data), input.active ?? true, actor?.id ?? null]);
    await audit(tx, actor?.id ?? null, 'reference.set', 'reference', `${input.department}/${input.kind}/${input.key}`, { before: before[0]?.data ?? null, after: input.data, active: input.active ?? true });
  });
}

/** Seeds rows that do not exist yet; never overwrites what an administrator changed. */
export async function seedReference(db: Queryable, rows: { department: string; kind: string; key: string; data: unknown }[]): Promise<number> {
  let added = 0;
  for (const r of rows) {
    const res = await db.query('INSERT INTO pricing.reference (department, kind, key, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING RETURNING key', [r.department, r.kind, r.key, JSON.stringify(r.data)]);
    added += res.length;
  }
  return added;
}

export async function quoteTerms(db: Queryable): Promise<string> {
  const rows = await db.query<{ data: { text?: string } }>("SELECT data FROM pricing.reference WHERE department = 'quote' AND kind = 'setting' AND key = 'terms' AND active");
  return rows[0]?.data.text ?? '';
}
