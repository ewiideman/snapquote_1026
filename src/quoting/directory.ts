// Customers and suppliers from the old SnapQuote, read from the CSV files exported from it (the new
// app never connects to the old database). Pure: given the rows and the names already here, it says
// what an import would add, what is already here, which rows say the same name twice, and which
// names look like the same company spelled two ways. Near-duplicates are named, never merged: only a
// person can say "Acme Medical" and "Acme Medical, Inc." are one customer.
import { emailDomainOf } from './email-domain.ts';

export type DirectoryKind = 'customer' | 'supplier';

export interface DirectoryEntry {
  name: string;
  /** Customers only: domains of the email addresses on the old rows, so their RFQ emails are recognized. */
  emailDomains: string[];
  /** Every old row with this name, field by field as exported. */
  imported: Record<string, string>[];
}

export interface DirectoryPlan {
  kind: DirectoryKind;
  add: DirectoryEntry[];
  /** Names already in this app (matched ignoring case and spacing); left as they are. */
  alreadyHere: string[];
  /** Names the export carries on more than one row; added once, with every row kept. */
  repeated: { name: string; rows: number }[];
  /** Pairs that differ only in punctuation or a company suffix (Inc, LLC, Corp...). Both are kept. */
  nearDuplicates: [string, string][];
  /** Rows not read, with the reason. */
  skipped: { row: number; reason: string }[];
}

/** The name as it is matched: case and runs of spaces do not count. */
export const nameKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
const tidy = (s: string): string => s.trim().replace(/\s+/g, ' ');

const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'l l c', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'lp', 'llp', 'plc', 'gmbh', 'the']);
/** Looser: punctuation and company suffixes dropped, for spotting the same company written two ways. */
export function looseKey(s: string): string {
  const words = nameKey(s).replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1] as string)) words.pop();
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

const NAME_COLUMNS = ['name', 'customer_name', 'company', 'company_name', 'supplier', 'supplier_name', 'vendor', 'vendor_name'];
const EMAIL_COLUMNS = ['email', 'contact_email'];

export function planDirectoryImport(kind: DirectoryKind, rows: string[][], existingRecords: { name: string; emailDomains?: string[] }[]): DirectoryPlan {
  const existingNames = existingRecords.map((r) => r.name);
  const takenDomains = new Set(existingRecords.flatMap((r) => r.emailDomains ?? []));
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const nameAt = NAME_COLUMNS.map((c) => header.indexOf(c)).find((i) => i >= 0);
  if (nameAt === undefined) throw new Error(`The ${kind} file has no name column (looked for ${NAME_COLUMNS.join(', ')}); its first row is: ${(rows[0] ?? []).join(', ')}`);
  const emailAt = kind === 'customer' ? EMAIL_COLUMNS.map((c) => header.indexOf(c)).filter((i) => i >= 0) : [];

  const existing = new Map(existingNames.map((n) => [nameKey(n), n]));
  const byKey = new Map<string, DirectoryEntry>();
  const alreadyHere = new Set<string>();
  const skipped: DirectoryPlan['skipped'] = [];
  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((c) => c.trim() === '')) return;
    const name = tidy(cells[nameAt] ?? '');
    if (!name) { skipped.push({ row, reason: 'no name' }); return; }
    if (name.length > 200) { skipped.push({ row, reason: 'name longer than 200 characters' }); return; }
    const key = nameKey(name);
    const here = existing.get(key);
    if (here !== undefined) { alreadyHere.add(here); return; }
    const fields: Record<string, string> = {};
    header.forEach((h, j) => { const v = (cells[j] ?? '').trim(); if (h && v !== '') fields[h] = v; });
    const entry = byKey.get(key) ?? { name, emailDomains: [], imported: [] };
    entry.imported.push(fields);
    for (const j of emailAt) {
      for (const address of (cells[j] ?? '').split(/[;,\s]+/)) {
        const d = emailDomainOf(address);
        if (d && !entry.emailDomains.includes(d)) entry.emailDomains.push(d);
      }
    }
    byKey.set(key, entry);
  });

  const add = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  // A domain belongs to one customer: the same domain on two would point an email at either, so a
  // domain shared in the export, or already a customer's here, is given to none of the new ones.
  if (kind === 'customer') {
    const owners = new Map<string, number>();
    for (const e of add) for (const d of e.emailDomains) owners.set(d, (owners.get(d) ?? 0) + 1);
    for (const e of add) e.emailDomains = e.emailDomains.filter((d) => owners.get(d) === 1 && !takenDomains.has(d));
  }
  const loose = new Map<string, string[]>();
  for (const n of [...add.map((e) => e.name), ...existingNames]) {
    const k = looseKey(n);
    if (k) loose.set(k, [...(loose.get(k) ?? []), n]);
  }
  const nearDuplicates: [string, string][] = [];
  for (const names of loose.values()) {
    const distinct = [...new Map(names.map((n) => [nameKey(n), n])).values()];
    for (let a = 0; a < distinct.length; a++) for (let b = a + 1; b < distinct.length; b++) nearDuplicates.push([distinct[a] as string, distinct[b] as string]);
  }
  return {
    kind,
    add,
    alreadyHere: [...alreadyHere].sort((a, b) => a.localeCompare(b)),
    repeated: add.filter((e) => e.imported.length > 1).map((e) => ({ name: e.name, rows: e.imported.length })),
    nearDuplicates: nearDuplicates.sort((a, b) => a[0].localeCompare(b[0])),
    skipped,
  };
}
