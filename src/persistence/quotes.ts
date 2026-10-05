// Quotes in the database: creating and editing them, sending them to the departments, prices,
// overrides, sending to the customer, and the outcome. Each step checks who may take it and
// whether the quote is where that step makes sense, and records what it did.
import type { Database, Queryable } from '../server/db.ts';
import type { Account } from './accounts.ts';
import { audit, HttpError } from './util.ts';
import { DEPARTMENTS, departmentName, isDepartment, type DepartmentKey } from '../quoting/departments.ts';
import {
  buildSheet, lineQuantities, qtyKey, sendToEstimatingProblems, stageOf, waitingOn,
  type PricedLine, type QuoteStatus, type RequestStatus, type Sheet, type Stage,
} from '../quoting/sheet.ts';

// ---------------------------------------------------------------- who may do what

const canSell = (a: Account) => a.role === 'sales' || a.role === 'manager' || a.role === 'administrator';
const canEstimate = (a: Account, dept: string) => (a.role === 'estimator' && a.department === dept) || a.role === 'manager' || a.role === 'administrator';

function requireSeller(a: Account): void {
  if (!canSell(a)) throw new HttpError(403, 'Only business development, managers and administrators can change a quote.');
}
function requireEstimator(a: Account, dept: string): void {
  if (!canEstimate(a, dept)) throw new HttpError(403, `Only ${departmentName(dept)} estimators, managers and administrators can price this.`);
}

// ---------------------------------------------------------------- reading

export interface QuoteHeader {
  id: number;
  number: string;
  revision: number;
  customerId: number | null;
  customerName: string | null;
  title: string;
  contactName: string | null;
  contactEmail: string | null;
  rfqReceivedOn: string | null;
  customerDueOn: string | null;
  ownerId: string;
  ownerName: string;
  quantities: number[];
  itar: boolean;
  notes: string;
  status: QuoteStatus;
  sourceEmail: { subject: string; from: string; date: string | null } | null;
  sentAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  poNumber: string | null;
  awardAmount: number | null;
  orderedQuantity: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Line {
  id: number;
  position: number;
  partNumber: string;
  revision: string;
  description: string;
  qtyPer: number;
  quantities: number[];
  department: DepartmentKey | null;
  notes: string;
  /** The line's quantities in pieces (its own, or the quote's breaks × quantity per). */
  pieceQuantities: number[];
  estimate: Estimate | null;
}

export interface Estimate {
  id: number;
  department: DepartmentKey;
  basis: 'calculator' | 'vendor_quote' | 'manual';
  prices: { quantity: number; unitPrice: number }[];
  oneTimeCost: number;
  oneTimeLabel: string;
  leadTimeWeeks: number | null;
  notes: string;
  inputs: unknown;
  detail: unknown;
  enteredBy: string;
  enteredByName: string;
  enteredAt: string;
}

export interface Request {
  id: number;
  department: DepartmentKey;
  status: RequestStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  neededBy: string | null;
  sentAt: string;
  answeredAt: string | null;
  answeredByName: string | null;
}

export interface Attachment { id: number; lineId: number | null; fileName: string; contentType: string; sizeBytes: number; source: 'upload' | 'email'; uploadedByName: string; uploadedAt: string }
export interface Message { id: number; department: string | null; authorName: string; kind: 'note' | 'question' | 'answer' | 'event'; body: string; at: string }

export interface QuoteDetail {
  quote: QuoteHeader;
  stage: Stage;
  lines: Line[];
  requests: Request[];
  attachments: Attachment[];
  messages: Message[];
  overrides: { lineId: number; quantity: number; unitPrice: number; reason: string; setByName: string; setAt: string }[];
  sheet: Sheet;
}

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type QuoteRow = {
  id: number; number: string; revision: number; customer_id: number | null; customer_name: string | null; title: string; contact_name: string | null; contact_email: string | null;
  rfq_received_on: string | null; customer_due_on: string | null; owner_id: string; owner_name: string; quantities: number[]; itar: boolean; notes: string; status: QuoteStatus;
  source_email: { subject: string; from: string; date: string | null } | null; sent_at: string | null; closed_at: string | null; close_reason: string | null; po_number: string | null;
  award_amount: string | null; ordered_quantity: number | null; created_at: string; updated_at: string;
};

const QUOTE_SELECT = `SELECT q.*, c.name AS customer_name, u.display_name AS owner_name
  FROM quote.quote q LEFT JOIN quote.customer c ON c.id = q.customer_id JOIN app.user_account u ON u.id = q.owner_id`;

const toHeader = (r: QuoteRow): QuoteHeader => ({
  id: r.id, number: r.number, revision: r.revision, customerId: r.customer_id, customerName: r.customer_name, title: r.title, contactName: r.contact_name, contactEmail: r.contact_email,
  rfqReceivedOn: r.rfq_received_on, customerDueOn: r.customer_due_on, ownerId: r.owner_id, ownerName: r.owner_name, quantities: r.quantities.map(Number), itar: r.itar, notes: r.notes,
  status: r.status, sourceEmail: r.source_email, sentAt: r.sent_at, closedAt: r.closed_at, closeReason: r.close_reason, poNumber: r.po_number, awardAmount: numOrNull(r.award_amount),
  orderedQuantity: r.ordered_quantity, createdAt: r.created_at, updatedAt: r.updated_at,
});

async function header(db: Queryable, id: number, lock = false): Promise<QuoteHeader> {
  const rows = await db.query<QuoteRow>(`${QUOTE_SELECT} WHERE q.id = $1${lock ? ' FOR UPDATE OF q' : ''}`, [id]);
  if (!rows[0]) throw new HttpError(404, 'No such quote.');
  return toHeader(rows[0]);
}

type LineRow = { id: number; position: number; part_number: string; revision: string; description: string; qty_per: string; quantities: string[]; department: DepartmentKey | null; notes: string };

async function lineRows(db: Queryable, quoteId: number): Promise<LineRow[]> {
  return db.query<LineRow>('SELECT id, position, part_number, revision, description, qty_per, quantities, department, notes FROM quote.line WHERE quote_id = $1 AND removed_at IS NULL ORDER BY position, id', [quoteId]);
}

async function currentEstimates(db: Queryable, lineIds: number[]): Promise<Map<number, Estimate>> {
  if (!lineIds.length) return new Map();
  const rows = await db.query<{ id: number; line_id: number; department: DepartmentKey; basis: Estimate['basis']; one_time_cost: string; one_time_label: string; lead_time_weeks: string | null; notes: string; inputs: unknown; detail: unknown; entered_by: string; entered_by_name: string; entered_at: string; prices: { quantity: string; unit_price: string }[] }>(
    `SELECT e.*, u.display_name AS entered_by_name,
            coalesce((SELECT json_agg(json_build_object('quantity', p.quantity, 'unit_price', p.unit_price) ORDER BY p.quantity) FROM quote.estimate_price p WHERE p.estimate_id = e.id), '[]') AS prices
       FROM quote.estimate e JOIN app.user_account u ON u.id = e.entered_by
      WHERE e.line_id = ANY($1::bigint[]) AND e.superseded_at IS NULL`, [lineIds]);
  return new Map(rows.map((r) => [r.line_id, {
    id: r.id, department: r.department, basis: r.basis, prices: r.prices.map((p) => ({ quantity: num(p.quantity), unitPrice: num(p.unit_price) })),
    oneTimeCost: num(r.one_time_cost), oneTimeLabel: r.one_time_label, leadTimeWeeks: numOrNull(r.lead_time_weeks), notes: r.notes, inputs: r.inputs, detail: r.detail,
    enteredBy: r.entered_by, enteredByName: r.entered_by_name, enteredAt: r.entered_at,
  }]));
}

export async function quoteDetail(db: Queryable, id: number): Promise<QuoteDetail> {
  const quote = await header(db, id);
  const rows = await lineRows(db, id);
  const estimates = await currentEstimates(db, rows.map((r) => r.id));
  const lines: Line[] = rows.map((r) => {
    const base = { id: r.id, qtyPer: num(r.qty_per), quantities: r.quantities.map(num) };
    return {
      ...base, position: r.position, partNumber: r.part_number, revision: r.revision, description: r.description, department: r.department, notes: r.notes,
      pieceQuantities: lineQuantities(quote.quantities, base), estimate: estimates.get(r.id) ?? null,
    };
  });
  const requests = (await db.query<{ id: number; department: DepartmentKey; status: RequestStatus; assignee_id: string | null; assignee_name: string | null; needed_by: string | null; sent_at: string; answered_at: string | null; answered_by_name: string | null }>(
    `SELECT r.id, r.department, r.status, r.assignee_id, a.display_name AS assignee_name, r.needed_by, r.sent_at, r.answered_at, b.display_name AS answered_by_name
       FROM quote.request r LEFT JOIN app.user_account a ON a.id = r.assignee_id LEFT JOIN app.user_account b ON b.id = r.answered_by
      WHERE r.quote_id = $1 AND r.status <> 'withdrawn' ORDER BY r.sent_at`, [id]))
    .map((r): Request => ({ id: r.id, department: r.department, status: r.status, assigneeId: r.assignee_id, assigneeName: r.assignee_name, neededBy: r.needed_by, sentAt: r.sent_at, answeredAt: r.answered_at, answeredByName: r.answered_by_name }));
  const attachments = (await db.query<{ id: number; line_id: number | null; file_name: string; content_type: string; size_bytes: number; source: 'upload' | 'email'; uploaded_by_name: string; uploaded_at: string }>(
    `SELECT a.id, a.line_id, a.file_name, a.content_type, a.size_bytes, a.source, u.display_name AS uploaded_by_name, a.uploaded_at
       FROM quote.attachment a JOIN app.user_account u ON u.id = a.uploaded_by WHERE a.quote_id = $1 AND a.removed_at IS NULL ORDER BY a.uploaded_at, a.id`, [id]))
    .map((a): Attachment => ({ id: a.id, lineId: a.line_id, fileName: a.file_name, contentType: a.content_type, sizeBytes: Number(a.size_bytes), source: a.source, uploadedByName: a.uploaded_by_name, uploadedAt: a.uploaded_at }));
  const messages = (await db.query<{ id: number; department: string | null; author_name: string; kind: Message['kind']; body: string; at: string }>(
    `SELECT m.id, m.department, u.display_name AS author_name, m.kind, m.body, m.at FROM quote.message m JOIN app.user_account u ON u.id = m.author_id WHERE m.quote_id = $1 ORDER BY m.at, m.id`, [id]))
    .map((m): Message => ({ id: m.id, department: m.department, authorName: m.author_name, kind: m.kind, body: m.body, at: m.at }));
  const overrides = (await db.query<{ line_id: number; quantity: string; unit_price: string; reason: string; set_by_name: string; set_at: string }>(
    `SELECT o.line_id, o.quantity, o.unit_price, o.reason, u.display_name AS set_by_name, o.set_at
       FROM quote.price_override o JOIN app.user_account u ON u.id = o.set_by
      WHERE o.line_id = ANY($1::bigint[]) AND o.cleared_at IS NULL`, [lines.map((l) => l.id)]))
    .map((o) => ({ lineId: o.line_id, quantity: num(o.quantity), unitPrice: num(o.unit_price), reason: o.reason, setByName: o.set_by_name, setAt: o.set_at }));
  const priced: PricedLine[] = lines.map((l) => ({
    id: l.id, qtyPer: l.qtyPer, quantities: l.quantities, department: l.department,
    estimate: l.estimate ? { prices: new Map(l.estimate.prices.map((p) => [qtyKey(p.quantity), p.unitPrice])), oneTimeCost: l.estimate.oneTimeCost, oneTimeLabel: l.estimate.oneTimeLabel, leadTimeWeeks: l.estimate.leadTimeWeeks } : null,
    overrides: new Map(overrides.filter((o) => o.lineId === l.id).map((o) => [qtyKey(o.quantity), { unitPrice: o.unitPrice, reason: o.reason }])),
  }));
  return { quote, stage: stageOf(quote.status, requests), lines, requests, attachments, messages, overrides, sheet: buildSheet(quote.quantities, priced) };
}

// ---------------------------------------------------------------- the board and the queue

export interface BoardCard {
  id: number;
  number: string;
  revision: number;
  customerName: string | null;
  title: string;
  ownerId: string;
  ownerName: string;
  stage: Stage;
  customerDueOn: string | null;
  itar: boolean;
  lineCount: number;
  departments: DepartmentKey[];
  waitingOn: DepartmentKey[];
  questionsFrom: DepartmentKey[];
  neededBy: string | null;
  /** Price at the first quantity: per assembly, or the sum of the lines; null until every line there is priced. */
  firstQuantity: number | null;
  firstTotal: number | null;
  awardAmount: number | null;
  updatedAt: string;
  closedAt: string | null;
}

/** Every open quote, and quotes closed in the last `closedDays` days. */
export async function board(db: Queryable, closedDays = 45): Promise<BoardCard[]> {
  const rows = await db.query<QuoteRow & { line_count: number; requests: { department: DepartmentKey; status: RequestStatus; needed_by: string | null }[] }>(
    `${QUOTE_SELECT.replace('SELECT q.*', `SELECT q.*,
        (SELECT count(*)::int FROM quote.line l WHERE l.quote_id = q.id AND l.removed_at IS NULL) AS line_count,
        coalesce((SELECT json_agg(json_build_object('department', r.department, 'status', r.status, 'needed_by', r.needed_by)) FROM quote.request r WHERE r.quote_id = q.id AND r.status <> 'withdrawn'), '[]') AS requests`)}
      WHERE q.status IN ('draft', 'estimating', 'sent') OR q.closed_at > now() - make_interval(days => $1)
      ORDER BY q.updated_at DESC`, [closedDays]);
  const out: BoardCard[] = [];
  for (const r of rows) {
    const h = toHeader(r);
    const detail = r.status === 'draft' ? null : await quoteDetail(db, r.id);
    const first = detail?.sheet.assembly?.[0] ?? null;
    const firstTotal = first ? first.extended : detail && detail.sheet.lines.length && detail.sheet.lines.every((l) => l.cells[0]?.extended !== null && l.cells[0] !== undefined)
      ? detail.sheet.lines.reduce((s, l) => s + (l.cells[0]?.extended ?? 0), 0) : null;
    const w = waitingOn(r.requests);
    const needed = r.requests.filter((x) => x.status === 'open' || x.status === 'question').map((x) => x.needed_by).filter((d): d is string => !!d).sort()[0] ?? null;
    out.push({
      id: h.id, number: h.number, revision: h.revision, customerName: h.customerName, title: h.title, ownerId: h.ownerId, ownerName: h.ownerName,
      stage: stageOf(h.status, r.requests), customerDueOn: h.customerDueOn, itar: h.itar, lineCount: r.line_count,
      departments: r.requests.map((x) => x.department), waitingOn: w.departments, questionsFrom: w.questions, neededBy: needed,
      firstQuantity: detail?.sheet.assembly ? (h.quantities[0] ?? null) : null, firstTotal, awardAmount: h.awardAmount, updatedAt: h.updatedAt, closedAt: h.closedAt,
    });
  }
  return out;
}

export interface QueueItem {
  requestId: number;
  quoteId: number;
  number: string;
  customerName: string | null;
  title: string;
  ownerName: string;
  status: RequestStatus;
  neededBy: string | null;
  customerDueOn: string | null;
  assigneeName: string | null;
  lines: number;
  priced: number;
  sentAt: string;
  itar: boolean;
}

/** A department's requests: open and waiting on business development first, then answered in the last 30 days. */
export async function queue(db: Queryable, department: DepartmentKey): Promise<QueueItem[]> {
  const rows = await db.query<{ request_id: number; quote_id: number; number: string; customer_name: string | null; title: string; owner_name: string; status: RequestStatus; needed_by: string | null; customer_due_on: string | null; assignee_name: string | null; lines: number; priced: number; sent_at: string; itar: boolean }>(
    `SELECT r.id AS request_id, q.id AS quote_id, q.number, c.name AS customer_name, q.title, o.display_name AS owner_name, r.status, r.needed_by, q.customer_due_on,
            a.display_name AS assignee_name, r.sent_at, q.itar,
            (SELECT count(*)::int FROM quote.line l WHERE l.quote_id = q.id AND l.department = r.department AND l.removed_at IS NULL) AS lines,
            (SELECT count(*)::int FROM quote.line l JOIN quote.estimate e ON e.line_id = l.id AND e.superseded_at IS NULL
              WHERE l.quote_id = q.id AND l.department = r.department AND l.removed_at IS NULL) AS priced
       FROM quote.request r JOIN quote.quote q ON q.id = r.quote_id LEFT JOIN quote.customer c ON c.id = q.customer_id
       JOIN app.user_account o ON o.id = q.owner_id LEFT JOIN app.user_account a ON a.id = r.assignee_id
      WHERE r.department = $1 AND q.status = 'estimating' AND (r.status IN ('open', 'question') OR r.answered_at > now() - interval '30 days')
      ORDER BY r.status = 'answered', r.needed_by NULLS LAST, r.sent_at`, [department]);
  return rows.map((r) => ({
    requestId: r.request_id, quoteId: r.quote_id, number: r.number, customerName: r.customer_name, title: r.title, ownerName: r.owner_name, status: r.status, neededBy: r.needed_by,
    customerDueOn: r.customer_due_on, assigneeName: r.assignee_name, lines: r.lines, priced: r.priced, sentAt: r.sent_at, itar: r.itar,
  }));
}

// ---------------------------------------------------------------- creating and editing

async function nextNumber(db: Queryable): Promise<string> {
  const year = Number(new Date().toISOString().slice(0, 4));
  const rows = await db.query<{ last: number }>(
    'INSERT INTO quote.number_counter (year, last) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET last = quote.number_counter.last + 1 RETURNING last', [year]);
  return `Q${String(year).slice(2)}-${String(rows[0]?.last).padStart(4, '0')}`;
}

async function touch(db: Queryable, id: number): Promise<void> {
  await db.query('UPDATE quote.quote SET updated_at = now() WHERE id = $1', [id]);
}

async function event(db: Queryable, quoteId: number, actor: string, body: string, department: string | null = null): Promise<void> {
  await db.query("INSERT INTO quote.message (quote_id, department, author_id, kind, body) VALUES ($1, $2, $3, 'event', $4)", [quoteId, department, actor, body]);
}

export async function createQuote(db: Database, actor: Account): Promise<number> {
  requireSeller(actor);
  return db.transaction(async (tx) => {
    const number = await nextNumber(tx);
    const rows = await tx.query<{ id: number }>('INSERT INTO quote.quote (number, owner_id) VALUES ($1, $2) RETURNING id', [number, actor.id]);
    const id = rows[0]?.id as number;
    await event(tx, id, actor.id, `${actor.displayName} started the quote.`);
    await audit(tx, actor.id, 'quote.created', 'quote', id, { number });
    return id;
  });
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const optText = (v: unknown, max = 500): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new HttpError(400, 'Expected text.');
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `Text is longer than ${max} characters.`);
  return t || null;
};

/** The customer named, made if it does not exist yet. Names are matched ignoring case and spaces at the ends. */
export async function customerByName(db: Queryable, name: string): Promise<number> {
  const clean = name.trim().replace(/\s+/g, ' ');
  const found = await db.query<{ id: number }>('SELECT id FROM quote.customer WHERE lower(btrim(name)) = lower($1)', [clean]);
  if (found[0]) return found[0].id;
  const rows = await db.query<{ id: number }>('INSERT INTO quote.customer (name) VALUES ($1) RETURNING id', [clean]);
  return rows[0]?.id as number;
}

const GENERIC_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'comcast.net', 'mack.com']);
export const emailDomain = (email: string | null | undefined): string | null => {
  const d = email?.split('@')[1]?.trim().toLowerCase();
  return d && !GENERIC_DOMAINS.has(d) ? d : null;
};

export async function customerForEmail(db: Queryable, email: string | null): Promise<{ id: number; name: string } | null> {
  const domain = emailDomain(email);
  if (!domain) return null;
  const rows = await db.query<{ id: number; name: string }>('SELECT id, name FROM quote.customer WHERE $1 = ANY(email_domains) ORDER BY id LIMIT 1', [domain]);
  return rows[0] ?? null;
}

export interface HeaderPatch {
  customerName?: unknown; title?: unknown; contactName?: unknown; contactEmail?: unknown; rfqReceivedOn?: unknown; customerDueOn?: unknown;
  ownerId?: unknown; quantities?: unknown; itar?: unknown; notes?: unknown;
}

function requireOpen(q: QuoteHeader): void {
  if (q.status === 'won' || q.status === 'lost' || q.status === 'no_bid') throw new HttpError(409, 'This quote is closed. Reopen it to change it.');
}

export async function updateHeader(db: Database, actor: Account, id: number, patch: HeaderPatch): Promise<void> {
  requireSeller(actor);
  await db.transaction(async (tx) => {
    const q = await header(tx, id, true);
    requireOpen(q);
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, value: unknown) => { params.push(value); sets.push(`${col} = $${params.length}`); };
    if (patch.customerName !== undefined) {
      const name = optText(patch.customerName, 200);
      const customerId = name ? await customerByName(tx, name) : null;
      set('customer_id', customerId);
      const domain = emailDomain(patch.contactEmail === undefined ? q.contactEmail : optText(patch.contactEmail));
      if (customerId && domain) await tx.query('UPDATE quote.customer SET email_domains = array_append(email_domains, $2) WHERE id = $1 AND NOT ($2 = ANY(email_domains))', [customerId, domain]);
    }
    if (patch.title !== undefined) set('title', optText(patch.title, 300) ?? '');
    if (patch.contactName !== undefined) set('contact_name', optText(patch.contactName, 200));
    if (patch.contactEmail !== undefined) set('contact_email', optText(patch.contactEmail, 200));
    for (const [key, col] of [['rfqReceivedOn', 'rfq_received_on'], ['customerDueOn', 'customer_due_on']] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      if (v !== null && v !== '' && !isDate(v)) throw new HttpError(400, 'Dates are YYYY-MM-DD.');
      set(col, v || null);
    }
    if (patch.ownerId !== undefined) {
      const owner = await tx.query("SELECT 1 FROM app.user_account WHERE id = $1 AND disabled_at IS NULL", [patch.ownerId]);
      if (!owner.length) throw new HttpError(400, 'No such person.');
      set('owner_id', patch.ownerId);
    }
    if (patch.quantities !== undefined) {
      if (!Array.isArray(patch.quantities) || !patch.quantities.every((n) => Number.isInteger(n) && n > 0)) throw new HttpError(400, 'Quantities are whole numbers above zero.');
      if (patch.quantities.length > 10) throw new HttpError(400, 'At most 10 quantities.');
      const qs = [...new Set(patch.quantities as number[])].sort((a, b) => a - b);
      set('quantities', qs);
      if (q.status === 'estimating') await reopenFor(tx, actor, id, (await lineRows(tx, id)).filter((l) => l.quantities.length === 0).map((l) => l.department), 'The quantities changed.');
    }
    if (patch.itar !== undefined) set('itar', patch.itar === true);
    if (patch.notes !== undefined) set('notes', optText(patch.notes, 10000) ?? '');
    if (!sets.length) return;
    await tx.query(`UPDATE quote.quote SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    await audit(tx, actor.id, 'quote.updated', 'quote', id, { fields: Object.keys(patch) });
  });
}

export interface LineInput { id?: unknown; partNumber?: unknown; revision?: unknown; description?: unknown; qtyPer?: unknown; quantities?: unknown; department?: unknown; notes?: unknown }

function cleanLine(l: LineInput): { partNumber: string; revision: string; description: string; qtyPer: number; quantities: number[]; department: DepartmentKey | null; notes: string } {
  const qtyPer = l.qtyPer === undefined || l.qtyPer === null || l.qtyPer === '' ? 1 : Number(l.qtyPer);
  if (!(qtyPer > 0) || qtyPer > 1e6) throw new HttpError(400, 'Quantity per assembly must be more than zero.');
  const quantities = l.quantities === undefined || l.quantities === null ? [] : l.quantities;
  if (!Array.isArray(quantities) || !quantities.every((n) => typeof n === 'number' && n > 0)) throw new HttpError(400, "A part's own quantities must be numbers above zero.");
  if (quantities.length > 10) throw new HttpError(400, 'At most 10 quantities.');
  if (l.department !== undefined && l.department !== null && l.department !== '' && !isDepartment(l.department)) throw new HttpError(400, 'Unknown department.');
  return {
    partNumber: optText(l.partNumber, 100) ?? '', revision: optText(l.revision, 20) ?? '', description: optText(l.description, 500) ?? '',
    qtyPer, quantities: [...new Set(quantities as number[])].sort((a, b) => a - b), department: (l.department || null) as DepartmentKey | null, notes: optText(l.notes, 2000) ?? '',
  };
}

/** Puts the requests of these departments back to open, because what they priced changed. */
async function reopenFor(db: Queryable, actor: Account, quoteId: number, departments: (DepartmentKey | null)[], why: string): Promise<void> {
  const unique = [...new Set(departments.filter((d): d is DepartmentKey => !!d))];
  for (const d of unique) {
    const rows = await db.query("UPDATE quote.request SET status = 'open', answered_at = NULL, answered_by = NULL WHERE quote_id = $1 AND department = $2 AND status = 'answered' RETURNING id", [quoteId, d]);
    if (rows.length) await event(db, quoteId, actor.id, `${why} ${departmentName(d)} has it back to check its prices.`, d);
  }
}

/** Makes sure every department with lines has a live request, and withdraws those with none. */
async function syncRequests(db: Queryable, actor: Account, quoteId: number, neededBy: string | null): Promise<void> {
  const depts = new Set((await lineRows(db, quoteId)).map((l) => l.department).filter((d): d is DepartmentKey => !!d));
  const live = await db.query<{ id: number; department: DepartmentKey }>("SELECT id, department FROM quote.request WHERE quote_id = $1 AND status <> 'withdrawn'", [quoteId]);
  for (const r of live) {
    if (!depts.has(r.department)) {
      await db.query("UPDATE quote.request SET status = 'withdrawn' WHERE id = $1", [r.id]);
      await event(db, quoteId, actor.id, `${departmentName(r.department)} no longer has any parts on this quote.`, r.department);
    }
  }
  for (const d of depts) {
    if (live.some((r) => r.department === d)) continue;
    await db.query('INSERT INTO quote.request (quote_id, department, needed_by, sent_by) VALUES ($1, $2, $3, $4)', [quoteId, d, neededBy, actor.id]);
    await event(db, quoteId, actor.id, `Sent to ${departmentName(d)}.`, d);
  }
}

/**
 * Replaces the quote's lines with these, in this order. A line with an id is updated; without one it is
 * added; a line left out is removed. While the departments have the quote, a change to what a
 * department priced (part, quantities, department) hands that department the quote back.
 */
export async function saveLines(db: Database, actor: Account, quoteId: number, input: unknown): Promise<{ added: number[] }> {
  requireSeller(actor);
  if (!Array.isArray(input)) throw new HttpError(400, 'lines must be a list');
  if (input.length > 500) throw new HttpError(400, 'At most 500 parts on a quote.');
  return db.transaction(async (tx) => {
    const q = await header(tx, quoteId, true);
    requireOpen(q);
    if (q.status === 'sent') throw new HttpError(409, 'This quote has been sent. Revise it to change its parts.');
    const existing = new Map((await lineRows(tx, quoteId)).map((l) => [l.id, l]));
    const kept = new Set<number>();
    const added: number[] = [];
    const touched: (DepartmentKey | null)[] = [];
    for (const [i, raw] of (input as LineInput[]).entries()) {
      const l = cleanLine(raw);
      const id = raw.id === undefined || raw.id === null ? null : Number(raw.id);
      if (id !== null) {
        const before = existing.get(id);
        if (!before) throw new HttpError(400, `Line ${id} is not on this quote.`);
        kept.add(id);
        const priceChanging = before.part_number !== l.partNumber || before.revision !== l.revision || Number(before.qty_per) !== l.qtyPer
          || before.quantities.map(Number).join(',') !== l.quantities.join(',') || before.department !== l.department;
        await tx.query('UPDATE quote.line SET position = $2, part_number = $3, revision = $4, description = $5, qty_per = $6, quantities = $7, department = $8, notes = $9 WHERE id = $1',
          [id, i + 1, l.partNumber, l.revision, l.description, l.qtyPer, l.quantities, l.department, l.notes]);
        if (before.department !== l.department) await tx.query('UPDATE quote.estimate SET superseded_at = now() WHERE line_id = $1 AND superseded_at IS NULL', [id]);
        if (priceChanging) touched.push(before.department, l.department);
      } else {
        const rows = await tx.query<{ id: number }>('INSERT INTO quote.line (quote_id, position, part_number, revision, description, qty_per, quantities, department, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [quoteId, i + 1, l.partNumber, l.revision, l.description, l.qtyPer, l.quantities, l.department, l.notes]);
        added.push(rows[0]?.id as number);
        touched.push(l.department);
      }
    }
    for (const [id, l] of existing) {
      if (kept.has(id)) continue;
      await tx.query('UPDATE quote.line SET removed_at = now() WHERE id = $1', [id]);
      touched.push(l.department);
    }
    if (q.status === 'estimating') {
      await reopenFor(tx, actor, quoteId, touched, 'The parts changed.');
      await syncRequests(tx, actor, quoteId, null);
    }
    await touch(tx, quoteId);
    await audit(tx, actor.id, 'quote.lines_saved', 'quote', quoteId, { lines: input.length, added: added.length });
    return { added };
  });
}

export async function sendToEstimating(db: Database, actor: Account, quoteId: number, input: { neededBy?: unknown; note?: unknown }): Promise<void> {
  requireSeller(actor);
  const neededBy = input.neededBy === undefined || input.neededBy === null || input.neededBy === '' ? null : input.neededBy;
  if (neededBy !== null && !isDate(neededBy)) throw new HttpError(400, 'Dates are YYYY-MM-DD.');
  await db.transaction(async (tx) => {
    const q = await header(tx, quoteId, true);
    if (q.status !== 'draft') throw new HttpError(409, 'This quote is already with the departments.');
    const lines = await lineRows(tx, quoteId);
    const problems = sendToEstimatingProblems({
      customer: q.customerId !== null, quantities: q.quantities,
      lines: lines.map((l) => ({ id: l.id, partNumber: l.part_number, description: l.description, department: l.department, quantities: l.quantities.map(Number) })),
    });
    if (problems.length) throw new HttpError(400, problems.join(' '));
    await tx.query("UPDATE quote.quote SET status = 'estimating', updated_at = now() WHERE id = $1", [quoteId]);
    const note = optText(input.note, 5000);
    if (note) await tx.query("INSERT INTO quote.message (quote_id, author_id, kind, body) VALUES ($1, $2, 'note', $3)", [quoteId, actor.id, note]);
    await syncRequests(tx, actor, quoteId, neededBy as string | null);
    await audit(tx, actor.id, 'quote.sent_to_estimating', 'quote', quoteId, { neededBy });
  });
}

// ---------------------------------------------------------------- the departments' side

export interface EstimateInput {
  basis?: unknown; prices?: unknown; oneTimeCost?: unknown; oneTimeLabel?: unknown; leadTimeWeeks?: unknown; notes?: unknown; inputs?: unknown; detail?: unknown;
}

/** A department prices one line: a unit price for each of the line's quantities. */
export async function saveEstimate(db: Database, actor: Account, lineId: number, input: EstimateInput): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.query<{ quote_id: number; department: DepartmentKey | null }>('SELECT quote_id, department FROM quote.line WHERE id = $1 AND removed_at IS NULL', [lineId]);
    const line = rows[0];
    if (!line) throw new HttpError(404, 'No such part.');
    if (!line.department) throw new HttpError(409, 'Nobody has been chosen to price this part.');
    requireEstimator(actor, line.department);
    const q = await header(tx, line.quote_id, true);
    if (q.status !== 'estimating') throw new HttpError(409, q.status === 'draft' ? 'This quote has not been sent to the departments yet.' : 'This quote is no longer being estimated.');
    const basis = input.basis;
    if (basis !== 'calculator' && basis !== 'vendor_quote' && basis !== 'manual') throw new HttpError(400, 'basis must be calculator, vendor_quote or manual');
    if (!Array.isArray(input.prices) || input.prices.length === 0) throw new HttpError(400, 'Give a price for at least one quantity.');
    const prices = (input.prices as { quantity?: unknown; unitPrice?: unknown }[]).map((p) => {
      const quantity = Number(p.quantity);
      const unitPrice = Number(p.unitPrice);
      if (!(quantity > 0) || !Number.isFinite(unitPrice) || unitPrice < 0) throw new HttpError(400, 'Each price needs a quantity above zero and a unit price of zero or more.');
      return { quantity: Math.round(quantity * 100) / 100, unitPrice: Math.round(unitPrice * 10000) / 10000 };
    });
    if (new Set(prices.map((p) => qtyKey(p.quantity))).size !== prices.length) throw new HttpError(400, 'A quantity is priced twice.');
    const oneTime = input.oneTimeCost === undefined || input.oneTimeCost === null || input.oneTimeCost === '' ? 0 : Number(input.oneTimeCost);
    if (!Number.isFinite(oneTime) || oneTime < 0) throw new HttpError(400, 'One-time cost must be zero or more.');
    const lead = input.leadTimeWeeks === undefined || input.leadTimeWeeks === null || input.leadTimeWeeks === '' ? null : Number(input.leadTimeWeeks);
    if (lead !== null && (!Number.isFinite(lead) || lead < 0 || lead > 520)) throw new HttpError(400, 'Lead time is weeks, zero or more.');
    await tx.query('UPDATE quote.estimate SET superseded_at = now() WHERE line_id = $1 AND superseded_at IS NULL', [lineId]);
    const est = await tx.query<{ id: number }>(
      'INSERT INTO quote.estimate (line_id, department, basis, one_time_cost, one_time_label, lead_time_weeks, notes, inputs, detail, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10) RETURNING id',
      [lineId, line.department, basis, oneTime, optText(input.oneTimeLabel, 200) ?? '', lead, optText(input.notes, 5000) ?? '', JSON.stringify(input.inputs ?? {}), JSON.stringify(input.detail ?? {}), actor.id]);
    for (const p of prices) await tx.query('INSERT INTO quote.estimate_price (estimate_id, quantity, unit_price) VALUES ($1, $2, $3)', [est[0]?.id, p.quantity, p.unitPrice]);
    // A new price after the department answered means its answer changed: business development sees it on the quote.
    const answered = await tx.query("SELECT 1 FROM quote.request WHERE quote_id = $1 AND department = $2 AND status = 'answered'", [line.quote_id, line.department]);
    if (answered.length) await event(tx, line.quote_id, actor.id, `${actor.displayName} changed a ${departmentName(line.department)} price after answering.`, line.department);
    await touch(tx, line.quote_id);
    await audit(tx, actor.id, 'estimate.saved', 'line', lineId, { basis, prices: prices.length });
  });
}

/** The department is done: every one of its parts is priced at every quantity. */
export async function answerRequest(db: Database, actor: Account, quoteId: number, department: string): Promise<void> {
  if (!isDepartment(department)) throw new HttpError(400, 'Unknown department.');
  requireEstimator(actor, department);
  await db.transaction(async (tx) => {
    await header(tx, quoteId, true);
    const detail = await quoteDetail(tx, quoteId);
    if (detail.quote.status !== 'estimating') throw new HttpError(409, 'This quote is not being estimated.');
    const req = detail.requests.find((r) => r.department === department);
    if (!req) throw new HttpError(404, `${departmentName(department)} has no request on this quote.`);
    const missing = detail.lines.filter((l) => l.department === department).filter((l) => {
      const priced = new Set((l.estimate?.prices ?? []).map((p) => qtyKey(p.quantity)));
      return l.pieceQuantities.some((qty) => !priced.has(qtyKey(qty)));
    });
    if (missing.length) throw new HttpError(400, `Price every quantity first: ${missing.map((l) => l.partNumber || l.description || `line ${l.position}`).join(', ')}.`);
    await tx.query("UPDATE quote.request SET status = 'answered', answered_at = now(), answered_by = $2 WHERE id = $1", [req.id, actor.id]);
    await event(tx, quoteId, actor.id, `${departmentName(department)} priced its parts (${actor.displayName}).`, department);
    await touch(tx, quoteId);
    await audit(tx, actor.id, 'request.answered', 'quote', quoteId, { department });
  });
}

export async function assignRequest(db: Database, actor: Account, quoteId: number, department: string, assigneeId: unknown): Promise<void> {
  if (!isDepartment(department)) throw new HttpError(400, 'Unknown department.');
  requireEstimator(actor, department);
  const assignee = assigneeId === null || assigneeId === '' ? null : String(assigneeId);
  if (assignee && !(await db.query('SELECT 1 FROM app.user_account WHERE id = $1 AND disabled_at IS NULL', [assignee])).length) throw new HttpError(400, 'No such person.');
  const rows = await db.query("UPDATE quote.request SET assignee_id = $3 WHERE quote_id = $1 AND department = $2 AND status <> 'withdrawn' RETURNING id", [quoteId, department, assignee]);
  if (!rows.length) throw new HttpError(404, 'No such request.');
  await audit(db, actor.id, 'request.assigned', 'quote', quoteId, { department, assignee });
}

/** A note on the quote. From a department, `question` puts its request on hold until business development answers. */
export async function postMessage(db: Database, actor: Account, quoteId: number, input: { body?: unknown; department?: unknown; question?: unknown }): Promise<void> {
  const body = optText(input.body, 10000);
  if (!body) throw new HttpError(400, 'Write something first.');
  await db.transaction(async (tx) => {
    await header(tx, quoteId, true);
    let kind: Message['kind'] = 'note';
    let department: DepartmentKey | null = null;
    if (input.question === true) {
      if (!isDepartment(input.department)) throw new HttpError(400, 'Which department is asking?');
      requireEstimator(actor, input.department);
      department = input.department;
      const rows = await tx.query("UPDATE quote.request SET status = 'question' WHERE quote_id = $1 AND department = $2 AND status IN ('open', 'answered') RETURNING id", [quoteId, department]);
      if (!rows.length) throw new HttpError(409, `${departmentName(department)} has nothing open on this quote to ask about.`);
      kind = 'question';
    } else if (canSell(actor)) {
      // Business development writing while a department waits on it answers that department.
      const answered = await tx.query<{ department: DepartmentKey }>("UPDATE quote.request SET status = 'open' WHERE quote_id = $1 AND status = 'question' RETURNING department", [quoteId]);
      if (answered.length) kind = 'answer';
    }
    await tx.query('INSERT INTO quote.message (quote_id, department, author_id, kind, body) VALUES ($1, $2, $3, $4, $5)', [quoteId, department, actor.id, kind, body]);
    await touch(tx, quoteId);
    await audit(tx, actor.id, `message.${kind}`, 'quote', quoteId, { department });
  });
}

// ---------------------------------------------------------------- business development's prices and the outcome

export async function setOverride(db: Database, actor: Account, lineId: number, input: { quantity?: unknown; unitPrice?: unknown; reason?: unknown }): Promise<void> {
  requireSeller(actor);
  const quantity = Number(input.quantity);
  if (!(quantity > 0)) throw new HttpError(400, 'quantity is required');
  await db.transaction(async (tx) => {
    const rows = await tx.query<{ quote_id: number }>('SELECT quote_id FROM quote.line WHERE id = $1 AND removed_at IS NULL', [lineId]);
    if (!rows[0]) throw new HttpError(404, 'No such part.');
    const q = await header(tx, rows[0].quote_id, true);
    if (q.status !== 'estimating' && q.status !== 'draft') throw new HttpError(409, q.status === 'sent' ? 'This quote has been sent. Revise it to change a price.' : 'This quote is closed.');
    await tx.query('UPDATE quote.price_override SET cleared_at = now() WHERE line_id = $1 AND quantity = $2 AND cleared_at IS NULL', [lineId, quantity]);
    if (input.unitPrice !== null && input.unitPrice !== undefined && input.unitPrice !== '') {
      const unitPrice = Number(input.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new HttpError(400, 'A price is zero or more.');
      const reason = optText(input.reason, 500);
      if (!reason) throw new HttpError(400, 'Say why the price differs from the estimate.');
      await tx.query('INSERT INTO quote.price_override (line_id, quantity, unit_price, reason, set_by) VALUES ($1, $2, $3, $4, $5)', [lineId, quantity, Math.round(unitPrice * 10000) / 10000, reason, actor.id]);
    }
    await touch(tx, q.id);
    await audit(tx, actor.id, 'price_override.set', 'line', lineId, { quantity, unitPrice: input.unitPrice ?? null });
  });
}

export async function markSent(db: Database, actor: Account, quoteId: number): Promise<void> {
  requireSeller(actor);
  await db.transaction(async (tx) => {
    await header(tx, quoteId, true);
    const d = await quoteDetail(tx, quoteId);
    if (d.quote.status !== 'estimating') throw new HttpError(409, d.quote.status === 'draft' ? 'Send it to the departments first.' : 'This quote has already been sent or closed.');
    if (!d.sheet.complete) throw new HttpError(400, 'Some parts have no price yet.');
    await tx.query("UPDATE quote.quote SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1", [quoteId]);
    await event(tx, quoteId, actor.id, `${actor.displayName} sent the quote to the customer${d.quote.revision ? ` (revision ${d.quote.revision})` : ''}.`);
    await audit(tx, actor.id, 'quote.sent', 'quote', quoteId, { revision: d.quote.revision });
  });
}

/** Back to the departments with a new revision number: the customer asked for a change. */
export async function reviseQuote(db: Database, actor: Account, quoteId: number, input: { reason?: unknown }): Promise<void> {
  requireSeller(actor);
  const reason = optText(input.reason, 2000);
  await db.transaction(async (tx) => {
    const q = await header(tx, quoteId, true);
    if (q.status === 'draft' || q.status === 'estimating') throw new HttpError(409, 'This quote can still be changed as it is.');
    await tx.query("UPDATE quote.quote SET status = 'estimating', revision = revision + 1, sent_at = NULL, closed_at = NULL, close_reason = NULL, po_number = NULL, award_amount = NULL, ordered_quantity = NULL, updated_at = now() WHERE id = $1", [quoteId]);
    await event(tx, quoteId, actor.id, `${actor.displayName} opened revision ${q.revision + 1}${reason ? `: ${reason}` : '.'}`);
    await audit(tx, actor.id, 'quote.revised', 'quote', quoteId, { revision: q.revision + 1, reason });
  });
}

export const LOST_REASONS = ['Price', 'Lead time', 'Went with another supplier', 'Customer canceled the project', 'No response from the customer', 'Other'] as const;

export async function closeQuote(db: Database, actor: Account, quoteId: number, input: { outcome?: unknown; reason?: unknown; poNumber?: unknown; awardAmount?: unknown; orderedQuantity?: unknown }): Promise<void> {
  requireSeller(actor);
  const outcome = input.outcome;
  if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'no_bid') throw new HttpError(400, 'outcome must be won, lost or no_bid');
  const reason = optText(input.reason, 1000);
  if (outcome !== 'won' && !reason) throw new HttpError(400, outcome === 'lost' ? 'Say why it was lost.' : 'Say why Mack is not bidding.');
  const award = input.awardAmount === undefined || input.awardAmount === null || input.awardAmount === '' ? null : Number(input.awardAmount);
  if (award !== null && (!Number.isFinite(award) || award < 0)) throw new HttpError(400, 'The award amount is zero or more.');
  await db.transaction(async (tx) => {
    const q = await header(tx, quoteId, true);
    requireOpen(q);
    if (outcome === 'won' && q.status !== 'sent') throw new HttpError(409, 'Only a quote the customer has can be won.');
    const ordered = outcome !== 'won' || input.orderedQuantity === undefined || input.orderedQuantity === null || input.orderedQuantity === '' ? null : Number(input.orderedQuantity);
    if (ordered !== null && !q.quantities.includes(ordered)) throw new HttpError(400, 'The quantity ordered is one of the quantities quoted.');
    await tx.query('UPDATE quote.quote SET status = $2, closed_at = now(), close_reason = $3, po_number = $4, award_amount = $5, ordered_quantity = $6, updated_at = now() WHERE id = $1',
      [quoteId, outcome, reason, outcome === 'won' ? optText(input.poNumber, 100) : null, outcome === 'won' ? award : null, ordered]);
    if (q.status === 'estimating') await tx.query("UPDATE quote.request SET status = 'withdrawn' WHERE quote_id = $1 AND status IN ('open', 'question')", [quoteId]);
    const words = outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : 'No bid';
    await event(tx, quoteId, actor.id, `${words}${reason ? `: ${reason}` : ''}${outcome === 'won' && input.poNumber ? ` (PO ${String(input.poNumber).trim()})` : ''}.`);
    await audit(tx, actor.id, 'quote.closed', 'quote', quoteId, { outcome, reason });
  });
}

// ---------------------------------------------------------------- pick lists

export async function customers(db: Queryable): Promise<{ id: number; name: string; emailDomains: string[]; quotes: number }[]> {
  const rows = await db.query<{ id: number; name: string; email_domains: string[]; quotes: number }>(
    'SELECT c.id, c.name, c.email_domains, (SELECT count(*)::int FROM quote.quote q WHERE q.customer_id = c.id) AS quotes FROM quote.customer c ORDER BY c.name');
  return rows.map((r) => ({ id: r.id, name: r.name, emailDomains: r.email_domains, quotes: r.quotes }));
}

export { DEPARTMENTS };
