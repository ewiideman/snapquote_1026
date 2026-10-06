// Customers and suppliers from the old SnapQuote into this one: the plan from the exported files
// against what is here now, and, when asked, adding it -- in one transaction, recorded in the audit.
import { readFileSync } from 'node:fs';
import type { Database, Queryable } from '../server/db.ts';
import { decodeText, parseCsv } from '../lib/csv.ts';
import { planDirectoryImport, type DirectoryKind, type DirectoryPlan } from '../quoting/directory.ts';
import { audit } from './util.ts';

async function existing(db: Queryable, kind: DirectoryKind): Promise<{ name: string; emailDomains: string[] }[]> {
  if (kind === 'customer') {
    return (await db.query<{ name: string; email_domains: string[] }>('SELECT name, email_domains FROM quote.customer'))
      .map((r) => ({ name: r.name, emailDomains: r.email_domains }));
  }
  return (await db.query<{ name: string }>('SELECT name FROM quote.supplier')).map((r) => ({ name: r.name, emailDomains: [] }));
}

export async function planFromFile(db: Queryable, kind: DirectoryKind, path: string): Promise<DirectoryPlan> {
  return planDirectoryImport(kind, parseCsv(decodeText(readFileSync(path)).text), await existing(db, kind));
}

/** Adds what the plan adds, recomputed inside the transaction so nothing added meanwhile is doubled. */
export async function applyDirectoryImport(db: Database, actor: string | null, kind: DirectoryKind, path: string): Promise<DirectoryPlan> {
  return db.transaction(async (tx) => {
    await tx.query(`LOCK TABLE quote.${kind} IN SHARE ROW EXCLUSIVE MODE`);
    const plan = await planFromFile(tx, kind, path);
    for (const e of plan.add) {
      const imported = { source: 'old SnapQuote export', file: path, rows: e.imported };
      if (kind === 'customer') {
        await tx.query('INSERT INTO quote.customer (name, email_domains, imported) VALUES ($1, $2, $3::jsonb)', [e.name, e.emailDomains, JSON.stringify(imported)]);
      } else {
        await tx.query('INSERT INTO quote.supplier (name, imported) VALUES ($1, $2::jsonb)', [e.name, JSON.stringify(imported)]);
      }
    }
    await audit(tx, actor, 'directory.imported', kind, null, {
      file: path, added: plan.add.length, alreadyHere: plan.alreadyHere.length, skipped: plan.skipped, nearDuplicates: plan.nearDuplicates,
    });
    return plan;
  });
}
