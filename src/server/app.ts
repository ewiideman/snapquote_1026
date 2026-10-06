// HTTP API and the built UI on Express 5. JSON in, JSON out; files come in as raw bodies. Everything but
// the health check and signing in needs a signed-in session, and whoever is signed in is the actor on
// every change.
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './db.ts';
import { PROJECT_ROOT } from './config.ts';
import { HttpError } from '../persistence/util.ts';
import {
  changeOwnPassword, createAccount, updateOwnEmail, listAccounts, listPeople, readCookie, sessionAccount, sessionCookie, signIn, signOut, updateAccount, SESSION_COOKIE, type Account,
} from '../persistence/accounts.ts';
import {
  answerRequest, assignRequest, board, closeQuote, createQuote, deletedQuotes, deleteQuote, restoreQuote, customers, LOST_REASONS, markSent, postMessage, queue, quoteDetail, reviseQuote, saveEstimate, saveLines,
  sendToEstimating, setOverride, updateHeader,
} from '../persistence/quotes.ts';
import { attachmentFile, dropFile, MAX_FILE_BYTES, readStored, removeAttachment } from '../persistence/files.ts';
import { addVendorQuote, priceFromVendor, removeVendorQuote, suppliers, vendorQuotes } from '../persistence/procurement.ts';
import { quoteTerms, referenceRows, setReference } from '../persistence/reference.ts';
import { quotePdf } from '../quoting/pdf.ts';
import { DEPARTMENTS, isDepartment } from '../quoting/departments.ts';
import { metalsRoutes } from './metalsRoutes.ts';
import { moldingRoutes } from './moldingRoutes.ts';
import { machiningAssemblyRoutes } from './machiningAssemblyRoutes.ts';
import type { ExchangeTimer } from './exchangeTimer.ts';
import { facilityMap, quoteCapacity, readCapacity, setFacilities } from '../persistence/exchange.ts';
import { referenceRows as metalsReference } from '../persistence/reference.ts';

const UI_ROOT = join(PROJECT_ROOT, 'dist', 'ui');

type Body = Record<string, unknown>;
const body = (req: Request): Body => (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? (req.body as Body) : {});
const id = (req: Request, name = 'id'): number => {
  const n = Number(req.params[name]);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a positive whole number`);
  return n;
};

export interface AppOptions {
  sessionHours?: number;
  storageDir: string;
  /** MACK_EXCHANGE_DIR, the folder shared with the Production Scheduler; null when there is no link. */
  exchangeDir?: string | null;
  exchange?: ExchangeTimer;
}

const PUBLIC = new Set(['GET /health', 'GET /session', 'POST /session']);
const WHILE_TEMPORARY = new Set([...PUBLIC, 'POST /session/password', 'POST /session/sign-out']);

const LOCK_AFTER = 5;
const LOCK_WINDOW_MS = 15 * 60_000;

export function createApp(db: Database, options: AppOptions): express.Express {
  const sessionHours = options.sessionHours ?? 168;
  const storageDir = options.storageDir;
  const exchangeDir = options.exchangeDir ?? null;
  const failures = new Map<string, { count: number; first: number }>();
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('cache-control', 'no-store');
    next();
  });
  // Writes are JSON or a raw file. An HTML form on another site can send neither, so it cannot forge one.
  api.use((req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.is('application/json') || req.is('application/octet-stream')) return next();
    next(new HttpError(415, 'Content-Type must be application/json, or application/octet-stream for a file.'));
  });
  api.use(express.json({ limit: '2mb' }));

  api.use(async (req, res, next) => {
    try {
      const token = readCookie(req.get('cookie'), SESSION_COOKIE);
      const account = token ? await sessionAccount(db, token) : null;
      res.locals['account'] = account;
      res.locals['token'] = token;
      const route = `${req.method} ${req.path}`;
      if (PUBLIC.has(route)) return next();
      if (!account) return next(new HttpError(401, 'Sign in first.'));
      if (account.mustChangePassword && !WHILE_TEMPORARY.has(route)) return next(new HttpError(403, 'Choose your own password first. The one you were given is temporary.'));
      next();
    } catch (err) {
      next(err);
    }
  });
  const me = (res: Response): Account => res.locals['account'] as Account;
  const requireAdministrator = (res: Response): Account => {
    const a = me(res);
    if (a.role !== 'administrator') throw new HttpError(403, 'Only an administrator can do this.');
    return a;
  };

  api.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  // ---- signing in
  api.get('/session', (_req, res) => {
    res.json({ account: res.locals['account'] ?? null, departments: DEPARTMENTS });
  });
  api.post('/session', async (req, res) => {
    const b = body(req);
    const key = typeof b['id'] === 'string' ? b['id'].trim().toLowerCase() : '';
    const now = Date.now();
    const f = failures.get(key);
    if (f && now - f.first > LOCK_WINDOW_MS) failures.delete(key);
    if ((failures.get(key)?.count ?? 0) >= LOCK_AFTER) throw new HttpError(429, 'Too many wrong passwords for this username. Wait 15 minutes, or ask an administrator to set a new password.');
    try {
      const s = await signIn(db, { id: b['id'], password: b['password'], sessionHours });
      failures.delete(key);
      res.set('set-cookie', sessionCookie(s.token, { maxAgeSeconds: (Date.parse(s.expiresAt) - Date.now()) / 1000, secure: req.secure }));
      res.json({ account: s.account, departments: DEPARTMENTS });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401 && key) {
        if (failures.size > 1000) for (const [k, v] of failures) if (now - v.first > LOCK_WINDOW_MS) failures.delete(k);
        const prior = failures.get(key);
        failures.set(key, { count: (prior?.count ?? 0) + 1, first: prior?.first ?? now });
      }
      throw err;
    }
  });
  api.post('/session/sign-out', async (req, res) => {
    const token = res.locals['token'] as string | null;
    if (token) await signOut(db, token);
    res.set('set-cookie', sessionCookie('', { maxAgeSeconds: 0, secure: req.secure }));
    res.json({ account: null });
  });
  api.patch('/session/me', async (req, res) => {
    const b = body(req);
    await updateOwnEmail(db, me(res).id, { email: b['email'], emailNotifications: b['emailNotifications'] });
    res.json({ account: await sessionAccount(db, res.locals['token'] as string) });
  });
  api.post('/session/password', async (req, res) => {
    const b = body(req);
    await changeOwnPassword(db, { userId: me(res).id, token: res.locals['token'] as string, currentPassword: b['currentPassword'], newPassword: b['newPassword'] });
    res.json({ account: await sessionAccount(db, res.locals['token'] as string) });
  });

  // ---- people
  api.get('/people', async (_req, res) => {
    res.json(await listPeople(db));
  });
  api.get('/users', async (_req, res) => {
    requireAdministrator(res);
    res.json(await listAccounts(db));
  });
  api.post('/users', async (req, res) => {
    const a = requireAdministrator(res);
    const b = body(req);
    res.status(201).json(await createAccount(db, a.id, { id: b['id'], displayName: b['displayName'], role: b['role'], department: b['department'], email: b['email'], password: b['password'] }));
  });
  api.patch('/users/:id', async (req, res) => {
    const a = requireAdministrator(res);
    await updateAccount(db, a.id, String(req.params['id']), body(req));
    res.json({ ok: true });
  });

  // ---- the board, the queue, quotes
  api.get('/board', async (_req, res) => {
    res.json(await board(db));
  });
  api.get('/queue/:department', async (req, res) => {
    const d = req.params['department'];
    if (!isDepartment(d)) throw new HttpError(400, 'Unknown department.');
    res.json(await queue(db, d));
  });
  api.get('/customers', async (_req, res) => {
    res.json(await customers(db));
  });
  api.post('/quotes', async (_req, res) => {
    const quoteId = await createQuote(db, me(res));
    res.status(201).json({ id: quoteId });
  });
  api.get('/quotes/:id', async (req, res) => {
    res.json({ ...(await quoteDetail(db, id(req))), lostReasons: LOST_REASONS });
  });
  api.patch('/quotes/:id', async (req, res) => {
    await updateHeader(db, me(res), id(req), body(req));
    res.json(await quoteDetail(db, id(req)));
  });
  api.put('/quotes/:id/lines', async (req, res) => {
    const r = await saveLines(db, me(res), id(req), body(req)['lines']);
    res.json({ ...r, quote: await quoteDetail(db, id(req)) });
  });
  api.post('/quotes/:id/send-to-estimating', async (req, res) => {
    const b = body(req);
    await sendToEstimating(db, me(res), id(req), { neededBy: b['neededBy'], note: b['note'] });
    res.json(await quoteDetail(db, id(req)));
  });
  api.post('/quotes/:id/messages', async (req, res) => {
    const b = body(req);
    await postMessage(db, me(res), id(req), { body: b['body'], department: b['department'], question: b['question'] });
    res.json(await quoteDetail(db, id(req)));
  });
  api.post('/quotes/:id/requests/:department/answer', async (req, res) => {
    await answerRequest(db, me(res), id(req), String(req.params['department']));
    res.json(await quoteDetail(db, id(req)));
  });
  api.post('/quotes/:id/requests/:department/assign', async (req, res) => {
    await assignRequest(db, me(res), id(req), String(req.params['department']), body(req)['assigneeId'] ?? null);
    res.json(await quoteDetail(db, id(req)));
  });
  api.post('/quotes/:id/sent', async (req, res) => {
    await markSent(db, me(res), id(req));
    res.json(await quoteDetail(db, id(req)));
  });
  api.post('/quotes/:id/revise', async (req, res) => {
    await reviseQuote(db, me(res), id(req), { reason: body(req)['reason'] });
    res.json(await quoteDetail(db, id(req)));
  });
  api.post('/quotes/:id/close', async (req, res) => {
    const b = body(req);
    await closeQuote(db, me(res), id(req), { outcome: b['outcome'], reason: b['reason'], poNumber: b['poNumber'], awardAmount: b['awardAmount'], orderedQuantity: b['orderedQuantity'] });
    void options.exchange?.writeNow(); // a win is news for the scheduler: tell it now, not in ten minutes
    res.json(await quoteDetail(db, id(req)));
  });
  // Deleting hides a quote everywhere and withdraws its open requests; it can be restored.
  api.post('/quotes/:id/delete', async (req, res) => {
    await deleteQuote(db, me(res), id(req), { reason: body(req)['reason'] });
    void options.exchange?.writeNow(); // gone from the scheduler's list too
    res.json({ ok: true });
  });
  api.post('/quotes/:id/restore', async (req, res) => {
    await restoreQuote(db, me(res), id(req));
    void options.exchange?.writeNow();
    res.json(await quoteDetail(db, id(req)));
  });
  api.get('/deleted-quotes', async (_req, res) => {
    res.json(await deletedQuotes(db));
  });
  api.get('/quotes/:id/pdf', async (req, res) => {
    const d = await quoteDetail(db, id(req));
    if (!d.sheet.complete) throw new HttpError(409, 'Some parts have no price yet.');
    const email = (await db.query<{ email: string | null }>('SELECT email FROM app.user_account WHERE id = $1', [d.quote.ownerId]))[0]?.email ?? null;
    const pdf = await quotePdf(d, { terms: await quoteTerms(db), preparedBy: { name: d.quote.ownerName, email }, today: new Date().toISOString().slice(0, 10) });
    const name = `${d.quote.number}${d.quote.revision ? `-rev${d.quote.revision}` : ''}${d.quote.customerName ? ` ${d.quote.customerName.replace(/[^A-Za-z0-9 ._-]/g, '')}` : ''}.pdf`;
    res.type('application/pdf').set('content-disposition', `${req.query['download'] ? 'attachment' : 'inline'}; filename="${name}"`).send(pdf);
  });

  // ---- prices
  api.put('/lines/:id/estimate', async (req, res) => {
    await saveEstimate(db, me(res), id(req), body(req));
    res.json({ ok: true });
  });
  api.put('/lines/:id/override', async (req, res) => {
    const b = body(req);
    await setOverride(db, me(res), id(req), { quantity: b['quantity'], unitPrice: b['unitPrice'], reason: b['reason'] });
    res.json({ ok: true });
  });

  // ---- procurement
  api.get('/suppliers', async (_req, res) => {
    res.json(await suppliers(db));
  });
  api.get('/lines/:id/vendor-quotes', async (req, res) => {
    res.json(await vendorQuotes(db, id(req)));
  });
  api.post('/lines/:id/vendor-quotes', async (req, res) => {
    res.status(201).json({ id: await addVendorQuote(db, me(res), id(req), body(req)) });
  });
  api.delete('/vendor-quotes/:id', async (req, res) => {
    await removeVendorQuote(db, me(res), id(req));
    res.json({ ok: true });
  });
  api.post('/lines/:id/price-from-vendor', async (req, res) => {
    await priceFromVendor(db, me(res), id(req), body(req));
    res.json({ ok: true });
  });

  // ---- metals calculator
  metalsRoutes(api, db, me);
  moldingRoutes(api, db, me);
  machiningAssemblyRoutes(api, db, me);

  // ---- the Production Scheduler
  api.get('/scheduler', (_req, res) => {
    res.json({ capacity: readCapacity(exchangeDir), exchange: options.exchange?.status() ?? null });
  });
  api.post('/scheduler/write', async (_req, res) => {
    requireAdministrator(res);
    if (!options.exchange) throw new HttpError(409, 'MACK_EXCHANGE_DIR is not set on this server.');
    res.json(await options.exchange.writeNow());
  });
  api.get('/quotes/:id/capacity', async (req, res) => {
    res.json(await quoteCapacity(db, id(req), exchangeDir));
  });
  // Metals work cells and the XA facilities Chris Glaski ties them to.
  api.get('/metals/facilities', async (_req, res) => {
    const order = (r: { data: unknown }) => (r.data as { sortOrder?: number }).sortOrder ?? 0;
    const cells = (await metalsReference(db, 'metals', 'work_cell')).filter((r) => r.active).sort((a, b) => order(a) - order(b));
    const map = await facilityMap(db);
    res.json({ capacity: readCapacity(exchangeDir), workCells: cells.map((c) => ({ name: c.key, mapping: map.get(c.key) ?? null })) });
  });
  api.put('/metals/facilities', async (req, res) => {
    const b = body(req);
    if (typeof b['workCell'] !== 'string') throw new HttpError(400, 'workCell is required');
    await setFacilities(db, me(res), b['workCell'], b['facilities'] === undefined ? null : b['facilities']);
    res.json({ ok: true });
  });

  // ---- files
  api.post('/quotes/:id/files', express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES }), async (req, res) => {
    const name = typeof req.query['name'] === 'string' ? req.query['name'] : '';
    if (!name) throw new HttpError(400, 'name is required');
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the file as the body.');
    res.status(201).json(await dropFile(db, me(res), id(req), { fileName: name, bytes: req.body }, storageDir));
  });
  api.get('/files/:id', async (req, res) => {
    const f = await attachmentFile(db, id(req));
    const bytes = readStored(storageDir, f.sha256);
    const inline = /^(application\/pdf|image\/(png|jpeg)|text\/plain)$/.test(f.contentType) && !req.query['download'];
    res.type(f.contentType).set('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`).set('x-content-type-options', 'nosniff').send(bytes);
  });
  api.delete('/files/:id', async (req, res) => {
    await removeAttachment(db, me(res), id(req));
    res.json({ ok: true });
  });

  // ---- settings
  api.get('/settings/terms', async (_req, res) => {
    res.json({ text: await quoteTerms(db) });
  });
  api.put('/settings/terms', async (req, res) => {
    const a = requireAdministrator(res);
    const text = body(req)['text'];
    if (typeof text !== 'string' || text.length > 5000) throw new HttpError(400, 'Terms are text, at most 5,000 characters.');
    await setReference(db, a, { department: 'quote', kind: 'setting', key: 'terms', data: { text } });
    res.json({ text });
  });
  api.get('/reference/:department', async (req, res) => {
    res.json(await referenceRows(db, String(req.params['department'])));
  });
  api.put('/reference/:department/:kind/:key', async (req, res) => {
    const a = requireAdministrator(res);
    const b = body(req);
    await setReference(db, a, { department: String(req.params['department']), kind: String(req.params['kind']), key: String(req.params['key']), data: b['data'], active: b['active'] !== false });
    res.json({ ok: true });
  });

  app.use('/api', api);

  app.use(express.static(UI_ROOT, { index: 'index.html', setHeaders: (res) => res.set('cache-control', 'no-store') }));
  app.get('/{*path}', (_req, res) => {
    if (!existsSync(join(UI_ROOT, 'index.html'))) {
      res.status(503).type('text/plain').send('The interface has not been built. Run: npm run build:ui');
      return;
    }
    res.set('cache-control', 'no-store').sendFile(join(UI_ROOT, 'index.html'));
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const e = err as Error & { status?: number; type?: string };
    let status = 500;
    if (err instanceof HttpError) status = err.status;
    else if (typeof e.status === 'number' && e.type) status = e.status; // body parser: 400 bad JSON, 413 too large
    if (status === 500) console.error(e);
    const message = e.type === 'entity.parse.failed' ? 'Body must be JSON' : e.type === 'entity.too.large' ? 'That is too large.' : e.message;
    res.status(status).set('cache-control', 'no-store').json({ error: message });
  });

  return app;
}
