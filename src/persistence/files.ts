// Files on a quote, kept on this server's disk under STORAGE_DIR, named by their SHA-256 so the same
// file dropped twice is stored once. The database keeps the name, type and who added it.
//
// Dropping files is also how a quote is started: an RFQ email gives the quote its subject, contact and
// date, and its own attachments; a spreadsheet with a part number or description column adds its rows
// as parts. Whatever was taken from a file is reported back, so nothing arrives unseen.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database, Queryable } from '../server/db.ts';
import type { Account } from './accounts.ts';
import { audit, HttpError, sha256 } from './util.ts';
import { isEmail, readEmail } from '../lib/email.ts';
import { isSpreadsheet, readSpreadsheet } from '../lib/spreadsheet.ts';
import { proposeLines } from '../quoting/bom.ts';
import { customerForEmail } from './quotes.ts';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface DropResult {
  attachments: { id: number; fileName: string }[];
  /** Parts added from spreadsheets, by file. */
  /** `alreadyOnQuote`: parts in the file that the quote already had, not added again. */
  linesAdded: { fileName: string; sheet: string | null; lineIds: number[]; alreadyOnQuote: number }[];
  /** Spreadsheets that looked like a parts list but gave nothing, and why. */
  notRead: { fileName: string; problem: string }[];
  /** What the RFQ email filled in on the quote. */
  fromEmail: { subject: string; from: string; date: string | null; customerName: string | null } | null;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', step: 'model/step', stp: 'model/step', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
  dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const typeOf = (fileName: string, given?: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? (given && given !== 'application/octet-stream' ? given : 'application/octet-stream');
};

const safeName = (name: string): string => name.replace(/[\\/\0]/g, '_').replace(/^\.+/, '').trim().slice(0, 200) || 'file';

function store(storageDir: string, bytes: Buffer): string {
  const hash = sha256(bytes);
  const dir = join(storageDir, hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, hash);
  if (!existsSync(path)) writeFileSync(path, bytes);
  return hash;
}

export function readStored(storageDir: string, hash: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, 'Bad file reference.');
  const path = join(storageDir, hash.slice(0, 2), hash);
  if (!existsSync(path)) throw new HttpError(410, 'The file is missing from the server.');
  return readFileSync(path);
}

async function insertAttachment(db: Queryable, actor: Account, quoteId: number, file: { fileName: string; contentType: string; bytes: Buffer }, source: 'upload' | 'email', storageDir: string): Promise<number> {
  const hash = store(storageDir, file.bytes);
  const rows = await db.query<{ id: number }>(
    'INSERT INTO quote.attachment (quote_id, file_name, content_type, size_bytes, sha256, source, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [quoteId, safeName(file.fileName), typeOf(file.fileName, file.contentType), file.bytes.length, hash, source, actor.id]);
  return rows[0]?.id as number;
}

/**
 * The same part twice is one part: an RFQ often carries its parts list both attached to the email and
 * as a separate file. A part is matched by part number and revision, or by description when it has no
 * part number; one already on the quote is skipped and counted, never merged into the one there.
 */
export const partKey = (l: { partNumber: string; revision: string; description: string }): string => {
  const n = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  return n(l.partNumber) ? `pn:${n(l.partNumber)}|${n(l.revision)}` : `desc:${n(l.description)}`;
};

async function addLines(db: Queryable, quoteId: number, lines: ReturnType<typeof proposeLines>['lines']): Promise<{ ids: number[]; skipped: number }> {
  const existing = await db.query<{ part_number: string; revision: string; description: string }>('SELECT part_number, revision, description FROM quote.line WHERE quote_id = $1 AND removed_at IS NULL', [quoteId]);
  const seen = new Set(existing.map((r) => partKey({ partNumber: r.part_number, revision: r.revision, description: r.description })));
  const start = (await db.query<{ n: number }>('SELECT coalesce(max(position), 0)::int AS n FROM quote.line WHERE quote_id = $1 AND removed_at IS NULL', [quoteId]))[0]?.n ?? 0;
  const ids: number[] = [];
  let skipped = 0;
  for (const l of lines.slice(0, 500)) {
    const key = partKey(l);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const rows = await db.query<{ id: number }>('INSERT INTO quote.line (quote_id, position, part_number, revision, description, qty_per, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [quoteId, start + ids.length + 1, l.partNumber.slice(0, 100), l.revision.slice(0, 20), l.description.slice(0, 500), l.qtyPer, l.notes.slice(0, 2000)]);
    ids.push(rows[0]?.id as number);
  }
  return { ids, skipped };
}

/** Adds one dropped file to a quote, reading it if it is an RFQ email or a parts spreadsheet. */
export async function dropFile(db: Database, actor: Account, quoteId: number, file: { fileName: string; contentType?: string; bytes: Buffer }, storageDir: string): Promise<DropResult> {
  if (file.bytes.length === 0) throw new HttpError(400, 'The file is empty.');
  if (file.bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'Files are limited to 100 MB.');
  const result: DropResult = { attachments: [], linesAdded: [], notRead: [], fromEmail: null };
  // Read before the transaction: parsing a large file should not hold the quote locked.
  const email = isEmail(file.fileName) ? await readEmail(file.fileName, file.bytes).catch(() => null) : null;
  const spreadsheets: { fileName: string; contentType: string; bytes: Buffer }[] = [];
  if (isSpreadsheet(file.fileName)) spreadsheets.push({ fileName: file.fileName, contentType: file.contentType ?? '', bytes: file.bytes });
  for (const a of email?.attachments ?? []) if (isSpreadsheet(a.fileName)) spreadsheets.push(a);
  const proposals = await Promise.all(spreadsheets.map(async (s) => {
    try {
      return { fileName: s.fileName, ...proposeLines(await readSpreadsheet(s.fileName, s.bytes)) };
    } catch {
      return { fileName: s.fileName, sheet: null, headerRow: null, lines: [], problem: 'The spreadsheet could not be read.' };
    }
  }));
  await db.transaction(async (tx) => {
    const q = (await tx.query<{ status: string; title: string; contact_email: string | null; customer_id: number | null; rfq_received_on: string | null; deleted_at: string | null }>(
      'SELECT deleted_at, status, title, contact_email, customer_id, rfq_received_on FROM quote.quote WHERE id = $1 FOR UPDATE', [quoteId]))[0];
    if (!q) throw new HttpError(404, 'No such quote.');
    if (q.deleted_at) throw new HttpError(409, 'This quote was deleted. Restore it to change it.');
    if (q.status === 'won' || q.status === 'lost' || q.status === 'no_bid') throw new HttpError(409, 'This quote is closed.');
    const canAddParts = actor.role !== 'estimator' && (q.status === 'draft' || q.status === 'estimating');
    result.attachments.push({ id: await insertAttachment(tx, actor, quoteId, { fileName: file.fileName, contentType: file.contentType ?? '', bytes: file.bytes }, 'upload', storageDir), fileName: safeName(file.fileName) });
    if (email) {
      for (const a of email.attachments) result.attachments.push({ id: await insertAttachment(tx, actor, quoteId, a, 'email', storageDir), fileName: safeName(a.fileName) });
      const from = email.fromName && email.fromAddress ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress || email.fromName;
      const customer = q.customer_id ? null : await customerForEmail(tx, email.fromAddress);
      await tx.query(
        `UPDATE quote.quote SET source_email = coalesce(source_email, $2::jsonb), title = CASE WHEN title = '' THEN $3 ELSE title END,
                contact_name = coalesce(contact_name, nullif($4, '')), contact_email = coalesce(contact_email, nullif($5, '')),
                rfq_received_on = coalesce(rfq_received_on, $6::date), customer_id = coalesce(customer_id, $7), updated_at = now() WHERE id = $1`,
        [quoteId, JSON.stringify({ subject: email.subject, from, date: email.date }), email.subject.replace(/^((re|fw|fwd|rfq|request for quot(e|ation))\s*:\s*)+/i, '').slice(0, 300),
          email.fromName.slice(0, 200), email.fromAddress.slice(0, 200), email.date ? email.date.slice(0, 10) : null, customer?.id ?? null]);
      if (email.text.trim()) await tx.query("INSERT INTO quote.message (quote_id, author_id, kind, body) VALUES ($1, $2, 'note', $3)", [quoteId, actor.id, `From the RFQ email (${from}):\n\n${email.text.trim().slice(0, 8000)}`]);
      result.fromEmail = { subject: email.subject, from, date: email.date, customerName: customer?.name ?? null };
    } else if (isEmail(file.fileName)) {
      result.notRead.push({ fileName: file.fileName, problem: 'The email could not be read; it is attached as it is.' });
    }
    for (const p of proposals) {
      if (!p.lines.length) {
        result.notRead.push({ fileName: p.fileName, problem: p.problem ?? 'No parts found.' });
        continue;
      }
      if (!canAddParts) {
        result.notRead.push({ fileName: p.fileName, problem: 'Attached; parts are only added from a file while the quote is being put together.' });
        continue;
      }
      const added = await addLines(tx, quoteId, p.lines);
      result.linesAdded.push({ fileName: p.fileName, sheet: p.sheet, lineIds: added.ids, alreadyOnQuote: added.skipped });
    }
    if (result.linesAdded.length && q.status === 'estimating') {
      await tx.query("INSERT INTO quote.message (quote_id, author_id, kind, body) VALUES ($1, $2, 'event', $3)", [quoteId, actor.id, 'Parts were added from a file. Choose who prices them.']);
    }
    await tx.query('UPDATE quote.quote SET updated_at = now() WHERE id = $1', [quoteId]);
    await audit(tx, actor.id, 'quote.file_dropped', 'quote', quoteId, { fileName: file.fileName, attachments: result.attachments.length, lines: result.linesAdded.reduce((s, l) => s + l.lineIds.length, 0) });
  });
  return result;
}

export async function attachmentFile(db: Queryable, id: number): Promise<{ fileName: string; contentType: string; sha256: string; quoteId: number }> {
  const rows = await db.query<{ file_name: string; content_type: string; sha256: string; quote_id: number }>('SELECT file_name, content_type, sha256, quote_id FROM quote.attachment WHERE id = $1 AND removed_at IS NULL', [id]);
  if (!rows[0]) throw new HttpError(404, 'No such file.');
  return { fileName: rows[0].file_name, contentType: rows[0].content_type, sha256: rows[0].sha256, quoteId: rows[0].quote_id };
}

export async function removeAttachment(db: Database, actor: Account, id: number): Promise<void> {
  const rows = await db.query<{ quote_id: number; uploaded_by: string }>('SELECT quote_id, uploaded_by FROM quote.attachment WHERE id = $1 AND removed_at IS NULL', [id]);
  const a = rows[0];
  if (!a) throw new HttpError(404, 'No such file.');
  if (actor.role === 'estimator' && a.uploaded_by !== actor.id) throw new HttpError(403, 'Estimators can remove only the files they added.');
  await db.query('UPDATE quote.attachment SET removed_at = now() WHERE id = $1', [id]);
  await audit(db, actor.id, 'attachment.removed', 'quote', a.quote_id, { attachment: id });
}
