// One quote on one page: what the customer asked for, who is pricing it, the files, the conversation,
// and the one thing to do next. Business development edits it; a department prices its own parts here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, patch, post, put, upload, del } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { DepartmentKey, DropResult, Line, QuoteDetail } from '../lib/types.ts';
import { STAGE_NAMES } from '../lib/types.ts';
import { canEstimate, canSell, DateField, DeptChip, Dialog, DropZone, ErrorBanner, GrowingText, plausibleDate, useApp } from '../components/ui.tsx';
import { ago, daysUntil, dueTone, dueWords, fileSize, qty, shortDate, usd } from '../lib/format.ts';
import { PricePanel } from './PricePanel.tsx';

// ---------------------------------------------------------------- quantities

function parseQuantities(text: string): number[] | string {
  const out: number[] = [];
  for (const p of text.split(/[\s,;/]+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)(k)?$/i.exec(p.replace(/,/g, ''));
    if (!m) return `"${p}" is not a quantity.`;
    const n = Math.round(Number(m[1]) * (m[2] ? 1000 : 1));
    if (!(n > 0)) return 'Quantities are more than zero.';
    out.push(n);
  }
  return out;
}

function Quantities({ value, onChange, disabled }: { value: number[]; onChange: (q: number[]) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const r = parseQuantities(text);
    if (typeof r === 'string') { setProblem(r); return; }
    if (!r.length) return;
    setProblem(null);
    setText('');
    onChange([...new Set([...value, ...r])].sort((a, b) => a - b).slice(0, 10));
  };
  return (
    <div>
      <div className="qty-chips">
        {value.map((q) => (
          <span className="q" key={q}>{qty(q)}{!disabled && <button aria-label={`Remove ${q}`} onClick={() => onChange(value.filter((x) => x !== q))}>×</button>}</span>
        ))}
        {!disabled && (
          <input placeholder={value.length ? 'Add another' : 'e.g. 100, 500, 1k'} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add} />
        )}
        {disabled && value.length === 0 && <span className="muted">None</span>}
      </div>
      {problem && <div className="hint" style={{ color: 'var(--late)' }}>{problem}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- saving

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Everything saves as you go; this says so, so nobody wonders whether to look for a Save button. */
function SaveStatus({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state === 'saving') return <span className="save-status">Saving…</span>;
  if (state === 'error') return <span className="save-status bad">Not saved — see the message below</span>;
  if (dirty) return <span className="save-status">Saves when you leave the field</span>;
  if (state === 'saved') return <span className="save-status ok">✓ All changes saved</span>;
  return <span className="save-status">Changes save as you go</span>;
}

/** Back to the departments as a new revision, with what the customer asked for. */
function ReviseDialog({ d, reopen, onClose, onDone }: { d: QuoteDetail; reopen: boolean; onClose: () => void; onDone: (n: QuoteDetail) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog title={reopen ? `Reopen ${d.quote.number}` : `Revise ${d.quote.number}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!reason.trim()} onClick={async () => {
        try { onDone(await post(`/quotes/${d.quote.id}/revise`, { reason })); } catch (err) { setError(err); }
      }}>Open revision {d.quote.revision + 1}</button>
    </>}>
      <p className="muted">The quote goes back to being worked on as revision {d.quote.revision + 1}. Prices stay as they are until you change a part; the departments whose parts change get it back.</p>
      <label className="field">{reopen ? 'Why is it being reopened?' : 'What did the customer ask to change?'}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={reopen ? 'e.g. The customer came back with a new quantity' : 'e.g. Add 2,500; drop the 100 quantity'} />
      </label>
      <ErrorBanner error={error} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- steps and the next thing to do

function Steps({ d }: { d: QuoteDetail }) {
  const order = ['draft', 'estimating', 'ready', 'sent', 'closed'] as const;
  const now = d.stage === 'won' || d.stage === 'lost' || d.stage === 'no_bid' ? 'closed' : d.stage;
  const idx = order.indexOf(now);
  const labels: Record<(typeof order)[number], string> = { draft: 'Put together', estimating: 'Departments price it', ready: 'Review and send', sent: 'With the customer', closed: 'Outcome' };
  const subs: Partial<Record<(typeof order)[number], string>> = {
    estimating: d.requests.length ? `${d.requests.filter((r) => r.status === 'answered').length} of ${d.requests.length} departments done` : '',
    sent: d.quote.sentAt ? `since ${shortDate(d.quote.sentAt)}` : '',
    closed: d.stage === 'won' ? 'Won' : d.stage === 'lost' ? 'Lost' : d.stage === 'no_bid' ? 'No bid' : '',
  };
  return (
    <div className="steps">
      {order.map((s, i) => (
        <div key={s} className={i < idx || (s === 'closed' && idx === 4) ? 'done' : i === idx ? 'now' : ''}>
          {i < idx ? '✓ ' : ''}{labels[s]}{subs[s] ? <small>{subs[s]}</small> : <small>&nbsp;</small>}
        </div>
      ))}
    </div>
  );
}

function draftProblems(d: QuoteDetail, lines: Line[]): string[] {
  const out: string[] = [];
  if (!d.quote.customerName) out.push('name the customer');
  if (!lines.length) out.push('add at least one part');
  if (lines.some((l) => !l.partNumber.trim() && !l.description.trim())) out.push('give every part a number or description');
  const noDept = lines.filter((l) => !l.department).length;
  if (noDept) out.push(`choose who prices ${noDept === 1 ? 'one part' : `${noDept} parts`}`);
  if (!d.quote.quantities.length && lines.some((l) => !l.quantities.length)) out.push('enter the quantities');
  return out;
}

function NextStep({ d, lines, reload, setError, dirty }: { d: QuoteDetail; lines: Line[]; reload: (n?: QuoteDetail) => void; setError: (e: unknown) => void; dirty: boolean }) {
  const app = useApp();
  const seller = canSell(app.account);
  const [neededBy, setNeededBy] = useState('');
  const [closing, setClosing] = useState<null | 'won' | 'lost' | 'no_bid'>(null);
  const [revising, setRevising] = useState(false);
  const run = async (fn: () => Promise<QuoteDetail>) => {
    setError(null);
    try { reload(await fn()); app.refreshCounts(); } catch (err) { setError(err); }
  };
  const myRequest = d.requests.find((r) => canEstimate(app.account, r.department) && app.account.role === 'estimator');
  const isPriced = (l: Line) => !!l.estimate && l.pieceQuantities.every((q) => l.estimate?.prices.some((p) => Math.abs(p.quantity - q) < 0.005));
  // A manager or administrator who priced a department's parts sends them back for it, as its estimator would.
  const owner = d.quote.ownerName.split(' ')[0];
  const sendBack = d.quote.status === 'estimating' && app.account.role !== 'estimator'
    ? d.requests.filter((r) => r.status === 'open' && canEstimate(app.account, r.department) && d.lines.some((l) => l.department === r.department) && d.lines.filter((l) => l.department === r.department).every(isPriced))
    : [];
  // One button for all of them: each department's prices go back in turn, as its estimator's would.
  const possessive = (name: string) => `${name}${name.endsWith('s') ? "'" : "'s"}`;
  const selfOwned = d.quote.ownerId === app.account.id;
  const who = sendBack.length === 1 ? app.deptName(sendBack[0]?.department ?? null) : sendBack.length === 2 ? 'both departments' : `all ${sendBack.length} departments`;
  const sendBackButtons = sendBack.length > 0 && (
    <button className="btn" onClick={() => run(async () => {
      let last: QuoteDetail | null = null;
      for (const r of sendBack) last = await post<QuoteDetail>(`/quotes/${d.quote.id}/requests/${r.department}/answer`);
      return last as QuoteDetail;
    })}>{selfOwned ? `Mark ${who} done` : `Send ${sendBack.length === 1 ? possessive(who) : `${who}'`} prices to ${owner}`}</button>
  );

  if (myRequest && d.quote.status === 'estimating') {
    const mine = d.lines.filter((l) => l.department === myRequest.department);
    const priced = mine.filter(isPriced).length;
    if (myRequest.status === 'answered') {
      return <div className="next calm"><p><b>✓ {app.deptName(myRequest.department)} has priced its parts.</b><span className="muted">Changing a price now tells {d.quote.ownerName.split(' ')[0]}.</span></p></div>;
    }
    if (myRequest.status === 'question') {
      return <div className="next calm"><p><b>Waiting on {d.quote.ownerName}'s answer to your question.</b><span className="muted">You can keep pricing meanwhile.</span></p></div>;
    }
    return (
      <div className="next">
        <p><b>Price {mine.length === 1 ? 'your part' : `your ${mine.length} parts`}, then send the prices back.</b>
          <span className="muted">{priced} of {mine.length} priced{myRequest.neededBy ? ` · needed ${shortDate(myRequest.neededBy)}` : ''}</span></p>
        <button className="btn primary" disabled={priced < mine.length} onClick={() => run(() => post(`/quotes/${d.quote.id}/requests/${myRequest.department}/answer`))}>Send prices to {d.quote.ownerName.split(' ')[0]}</button>
      </div>
    );
  }
  if (!seller) return null;

  if (d.stage === 'draft') {
    const problems = draftProblems(d, lines);
    return (
      <div className="next">
        <p><b>{problems.length ? 'To send it to the departments,' : 'Ready for the departments.'}</b>
          <span className="muted">{problems.length ? `${problems.join(', ')}.` : `${[...new Set(lines.map((l) => l.department))].map((k) => app.deptName(k)).join(', ')} will get it in their queue.`}</span></p>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>Prices needed by
          <input type="date" value={neededBy} min="2000-01-01" max="2100-12-31" onChange={(e) => setNeededBy(e.target.value)} />
        </label>
        <button className="btn primary" disabled={problems.length > 0 || dirty || (neededBy !== '' && !plausibleDate(neededBy))} onClick={() => run(() => post(`/quotes/${d.quote.id}/send-to-estimating`, { neededBy: neededBy || null }))}>Send to the departments</button>
      </div>
    );
  }
  if (d.stage === 'estimating') {
    const questions = d.requests.filter((r) => r.status === 'question');
    const waiting = d.requests.filter((r) => r.status === 'open');
    if (questions.length) {
      return <div className="next" style={{ borderColor: 'var(--ask-line)', boxShadow: '0 0 0 3px var(--ask-soft)' }}><p><b>{questions.map((r) => app.deptName(r.department)).join(' and ')} asked you something.</b><span className="muted">Answer in the conversation; your reply sends it back to them.</span></p><a className="btn" href="#conversation">Answer</a></div>;
    }
    const names = (rs: typeof waiting) => rs.map((r) => app.deptName(r.department)).join(', ');
    // Every part has a price: the next step is the review, whether or not each department has said it is done.
    if (d.sheet.complete) {
      return (
        <div className="next">
          <p><b>Every part has a price.</b>
            <span className="muted">{waiting.length <= 2 ? names(waiting) : `${waiting.length} departments`} {waiting.length === 1 ? "hasn't" : "haven't"} marked {waiting.length === 1 ? 'its' : 'their'} prices done{sendBack.length ? '' : ', so a price may still change'}. You can review and send now.</span></p>
          {sendBackButtons}
          <a className="btn primary" href={`#/quotes/${d.quote.id}/send`}>Review and send</a>
        </div>
      );
    }
    return (
      <div className="next calm">
        <p><b>Waiting on {names(waiting)}.</b>
          <span className="muted">You can still change the parts; a department whose parts change gets the quote back.</span></p>
        {sendBackButtons}
        <a className="btn" href={`#/quotes/${d.quote.id}/send`}>See prices so far</a>
      </div>
    );
  }
  if (d.stage === 'ready') {
    return <div className="next"><p><b>Every department has priced it.</b><span className="muted">Check the prices, adjust any, and send the customer their copy.</span></p><a className="btn primary" href={`#/quotes/${d.quote.id}/send`}>Review and send</a></div>;
  }
  if (d.stage === 'sent') {
    return (
      <>
        <div className="next">
          <p><b>With {d.quote.customerName} since {shortDate(d.quote.sentAt)}.</b><span className="muted">When you hear back, record it — won quotes are how the plant sees what is coming.</span></p>
          <button className="btn primary" onClick={() => setClosing('won')}>Won</button>
          <button className="btn" onClick={() => setClosing('lost')}>Lost</button>
          <button className="btn ghost" onClick={() => setRevising(true)}>Revise</button>
        </div>
        {closing && <CloseDialog d={d} outcome={closing} onClose={() => setClosing(null)} onDone={(n) => { setClosing(null); reload(n); app.refreshCounts(); }} />}
        {revising && <ReviseDialog d={d} reopen={false} onClose={() => setRevising(false)} onDone={(n) => { setRevising(false); reload(n); app.refreshCounts(); }} />}
      </>
    );
  }
  return (
    <div className="next calm">
      <p><b>{STAGE_NAMES[d.stage]}{d.quote.closedAt ? ` on ${shortDate(d.quote.closedAt)}` : ''}.</b>
        <span className="muted">{[d.quote.closeReason, d.quote.poNumber ? `PO ${d.quote.poNumber}` : '', d.quote.awardAmount !== null ? usd(d.quote.awardAmount, 0) : ''].filter(Boolean).join(' · ')}</span></p>
      <button className="btn ghost" onClick={() => setRevising(true)}>Reopen as a revision</button>
      {revising && <ReviseDialog d={d} reopen onClose={() => setRevising(false)} onDone={(n) => { setRevising(false); reload(n); app.refreshCounts(); }} />}
    </div>
  );
}

function DeleteDialog({ d, onClose }: { d: QuoteDetail; onClose: () => void }) {
  const app = useApp();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const q = d.quote;
  const open = d.requests.filter((r) => r.status === 'open' || r.status === 'question');
  return (
    <Dialog title={`Delete ${q.number}${q.revision ? ` rev ${q.revision}` : ''}?`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn danger" onClick={async () => {
        setError(null);
        try {
          await post(`/quotes/${q.id}/delete`, { reason });
          app.refreshCounts();
          location.hash = '#/';
          app.toast(`${q.number} deleted.`, { label: 'Undo', run: () => { void post(`/quotes/${q.id}/restore`).then(() => { app.toast(`${q.number} restored.`); app.refreshCounts(); location.hash = `#/quotes/${q.id}`; }); } });
        } catch (err) { setError(err); }
      }}>Delete</button>
    </>}>
      <p className="muted">It comes off the board{open.length ? ` and off ${open.map((r) => app.deptName(r.department)).join(' and ')}'s queue${open.length > 1 ? 's' : ''} (they get an email saying no prices are needed)` : ''}. Nothing on it is lost: it can be restored from Deleted quotes on the board.</p>
      <label className="field">Why? (optional)<textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Duplicate of Q26-0012, or the customer withdrew the RFQ" /></label>
      <ErrorBanner error={error} />
    </Dialog>
  );
}

export function CloseDialog({ d, outcome, onClose, onDone }: { d: QuoteDetail; outcome: 'won' | 'lost' | 'no_bid'; onClose: () => void; onDone: (d: QuoteDetail) => void }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [po, setPo] = useState('');
  const [ordered, setOrdered] = useState<number | null>(d.quote.quantities.length === 1 ? d.quote.quantities[0] ?? null : null);
  const orderValue = (q: number | null) => (q === null ? null : d.sheet.assembly?.find((b) => b.quantity === q)?.extended ?? null);
  const [amount, setAmount] = useState(() => (orderValue(ordered) ?? '').toString());
  const [error, setError] = useState<unknown>(null);
  const finalReason = reason === 'Other' ? other : reason;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true">
        <header><h2>{outcome === 'won' ? `Won — congratulations` : outcome === 'lost' ? 'Lost' : 'Not bidding'}</h2></header>
        <div className="body">
          {outcome === 'won' ? (
            <div className="grid2">
              {d.quote.quantities.length > 0 && (
                <label className="field" style={{ gridColumn: '1 / -1' }}>Quantity ordered — the Production Scheduler counts the work at this quantity
                  <select value={ordered ?? ''} onChange={(e) => { const q = e.target.value ? Number(e.target.value) : null; setOrdered(q); const v = orderValue(q); if (v !== null) setAmount(String(v)); }}>
                    <option value="">Not known yet</option>
                    {d.quote.quantities.map((q) => <option key={q} value={q}>{q.toLocaleString('en-US')}</option>)}
                  </select>
                </label>
              )}
              <label className="field">Customer PO number<input value={po} onChange={(e) => setPo(e.target.value)} autoFocus /></label>
              <label className="field">Order value ($)<input className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            </div>
          ) : (
            <>
              <label className="field">{outcome === 'lost' ? 'Why was it lost?' : 'Why is Mack not bidding?'}
                {outcome === 'lost' ? (
                  <select value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
                    <option value="">Choose…</option>
                    {d.lostReasons.map((r) => <option key={r}>{r}</option>)}
                  </select>
                ) : <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
              </label>
              {reason === 'Other' && <label className="field">In a few words<input value={other} onChange={(e) => setOther(e.target.value)} /></label>}
            </>
          )}
          <ErrorBanner error={error} />
        </div>
        <footer>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={outcome !== 'won' && !finalReason.trim()} onClick={async () => {
            try {
              onDone(await post(`/quotes/${d.quote.id}/close`, { outcome, reason: finalReason || null, poNumber: po || null, awardAmount: amount === '' ? null : Number(amount.replace(/[$,]/g, '')), orderedQuantity: ordered }));
            } catch (err) { setError(err); }
          }}>Record it</button>
        </footer>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the parts

type Draft = Pick<Line, 'partNumber' | 'revision' | 'description' | 'qtyPer' | 'department' | 'notes' | 'quantities'> & { id: number | null; key: string };
const toDraft = (l: Line): Draft => ({ id: l.id, key: String(l.id), partNumber: l.partNumber, revision: l.revision, description: l.description, qtyPer: l.qtyPer, department: l.department, notes: l.notes, quantities: l.quantities });
const blank = (): Draft => ({ id: null, key: `new-${Math.random()}`, partNumber: '', revision: '', description: '', qtyPer: 1, department: null, notes: '', quantities: [] });

function Parts({ d, editable, onSaved, onDirty, onSaveState, openPrice }: { d: QuoteDetail; editable: boolean; onSaved: (n: QuoteDetail) => void; onDirty: (b: boolean) => void; onSaveState: (s: SaveState) => void; openPrice: (l: Line) => void }) {
  const app = useApp();
  const [rows, setRows] = useState<Draft[]>(() => d.lines.map(toDraft));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Rows with their own-quantities editor open (one with quantities always shows it).
  const [ownOpen, setOwnOpen] = useState<Set<string>>(() => new Set());
  // One save at a time. An edit made while a save is in flight is saved right after it, from the
  // latest rows, so a quick second change is never lost.
  const saving = useRef(false);
  const pending = useRef<Draft[] | null>(null);
  useEffect(() => { if (!dirty) setRows(d.lines.map(toDraft)); }, [d, dirty]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = async (next = rows): Promise<void> => {
    if (saving.current) { pending.current = next; return; }
    saving.current = true;
    setError(null);
    onSaveState('saving');
    try {
      const r = await put<{ quote: QuoteDetail }>(`/quotes/${d.quote.id}/lines`, {
        lines: next.map((x) => ({ id: x.id, partNumber: x.partNumber, revision: x.revision, description: x.description, qtyPer: x.qtyPer, department: x.department, notes: x.notes, quantities: x.quantities })),
      });
      const queued = pending.current;
      pending.current = null;
      if (queued) {
        // Lines come back in the order they were sent, so rows this save added get their ids by key.
        const ids = new Map(next.map((x, i) => [x.key, r.quote.lines[i]?.id ?? null]));
        const withIds = queued.map((x) => (x.id === null && ids.get(x.key) ? { ...x, id: ids.get(x.key) as number } : x));
        saving.current = false;
        return save(withIds);
      }
      setDirty(false);
      onSaved(r.quote);
      onSaveState('saved');
    } catch (err) {
      pending.current = null;
      setError(err);
      onSaveState('error');
    } finally {
      saving.current = false;
    }
  };
  const edit = (key: string, change: Partial<Draft>, now = false) => {
    const next = rows.map((r) => (r.key === key ? { ...r, ...change } : r));
    setRows(next);
    setDirty(true);
    if (now) void save(next);
  };
  const byId = new Map(d.lines.map((l) => [l.id, l]));
  const sheetById = new Map(d.sheet.lines.map((s) => [s.lineId, s]));
  const firstQty = d.quote.quantities[0];
  const showPrices = d.quote.status !== 'draft';
  const allSame = rows.length > 1 && rows.every((r) => r.department === rows[0]?.department) ? rows[0]?.department : undefined;

  // The last column holds the price button when there is one, and the remove button.
  const priceButtons = d.lines.some((l) => (d.quote.status === 'estimating' && canEstimate(app.account, l.department)) || !!l.estimate);
  const actionsWidth = priceButtons ? (editable ? 136 : 112) : 40;
  return (
    <div className="section">
      <header>
        <h2>Parts <span className="muted" style={{ fontWeight: 400 }}>{rows.length ? `· ${rows.length}` : ''}</span></h2>
        {editable && rows.length > 1 && (
          <div className="row small"><span className="muted">All priced by</span>
            <div className="dept-pick">
              {app.departments.map((dep) => <button key={dep.key} className={allSame === dep.key ? 'on' : ''} onClick={() => { const next = rows.map((r) => ({ ...r, department: dep.key })); setRows(next); setDirty(true); void save(next); }}>{dep.name.replace(' (ADC)', '')}</button>)}
            </div>
          </div>
        )}
      </header>
      {rows.length === 0 ? (
        <div className="empty">{editable ? 'Drop a parts list or BOM spreadsheet under Files, or add parts one at a time.' : 'No parts.'}</div>
      ) : (
        <table className="grid edit parts">
          <colgroup>
            <col className="c-pos" /><col /><col className="c-qty" /><col className="c-who" />
            {showPrices && <col className="c-price" />}
            <col style={{ width: actionsWidth }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th><th>Part</th>
              <th className="right" title="How many of this part go into one assembly">Qty per assembly</th><th>Who prices it</th>
              {showPrices && <th className="right">{firstQty ? `Each at ${qty(firstQty)}` : 'Price'}</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const line = r.id ? byId.get(r.id) : undefined;
              const cell = r.id ? sheetById.get(r.id)?.cells[0] : undefined;
              const mineToPrice = !!line && d.quote.status === 'estimating' && canEstimate(app.account, line.department);
              return (
                <tr key={r.key} className={mineToPrice ? 'mine' : ''}>
                  <td className="pos" style={{ paddingLeft: 10 }}>{i + 1}</td>
                  <td className="part">
                    {/* The part number and revision on one line, the description under them with the row's width to itself. */}
                    {editable ? (
                      <div className="part-line">
                        <input className="bare mono pn" value={r.partNumber} placeholder="Part number" aria-label={`Part number of part ${i + 1}`} onChange={(e) => edit(r.key, { partNumber: e.target.value })} onBlur={() => dirty && save()} />
                        <label className="rev"><span>Rev</span><input className="bare" value={r.revision} aria-label={`Revision of part ${i + 1}`} onChange={(e) => edit(r.key, { revision: e.target.value })} onBlur={() => dirty && save()} /></label>
                        {r.quantities.length === 0 && !ownOpen.has(r.key) && <button className="link row-more own-link" onClick={() => setOwnOpen((o) => new Set(o).add(r.key))}>Own quantities…</button>}
                      </div>
                    ) : <div className="part-line read"><span className="mono">{r.partNumber || '—'}</span>{r.revision && <span className="muted small">Rev {r.revision}</span>}</div>}
                    {editable ? <GrowingText value={r.description} placeholder="Description" aria-label={`Description of part ${i + 1}`} onChange={(v) => edit(r.key, { description: v })} onBlur={() => dirty && save()} /> : <div className="desc">{r.description}</div>}
                    {r.notes && <div className="sub" style={{ paddingLeft: editable ? 7 : 0 }}>{r.notes}</div>}
                    {editable && (r.quantities.length > 0 || ownOpen.has(r.key)) ? (
                      <div className="sub own-qty" style={{ paddingLeft: 7 }}>
                        <span>Own quantities, in pieces, instead of the quote's</span>
                        <Quantities value={r.quantities} disabled={false} onChange={(q) => edit(r.key, { quantities: q }, true)} />
                        <button className="link" onClick={() => { setOwnOpen((o) => { const n = new Set(o); n.delete(r.key); return n; }); if (r.quantities.length) edit(r.key, { quantities: [] }, true); }}>Use the quote's quantities</button>
                      </div>
                    ) : !editable && r.quantities.length > 0 && <div className="sub">Own quantities: {r.quantities.map(qty).join(', ')} pieces</div>}
                  </td>
                  <td className="right">{r.quantities.length > 0 ? <span className="muted small" title="This part is priced at its own quantities, so quantity per assembly is not used.">own</span> : editable ? <input className="bare num" value={String(r.qtyPer)} onChange={(e) => { const n = Number(e.target.value); if (n > 0) edit(r.key, { qtyPer: n }); }} onBlur={() => dirty && save()} /> : <span className="right">{qty(r.qtyPer)}</span>}</td>
                  <td>{editable ? (
                    <select className="bare" value={r.department ?? ''} onChange={(e) => edit(r.key, { department: (e.target.value || null) as DepartmentKey | null }, true)} style={!r.department ? { color: 'var(--late)' } : undefined}>
                      <option value="">Choose…</option>
                      {app.departments.map((dep) => <option key={dep.key} value={dep.key}>{dep.name}</option>)}
                    </select>
                  ) : app.deptName(r.department)}</td>
                  {showPrices && (
                    <td className="right">
                      {cell?.unitPrice !== null && cell?.unitPrice !== undefined ? <span className={cell.override !== null ? 'ov' : ''}>{usd(cell.unitPrice)}</span> : <span className="muted small">{line?.estimate ? '—' : 'not yet'}</span>}
                    </td>
                  )}
                  <td className="actions">
                    {mineToPrice && line && <button className={`btn small ${line.estimate ? '' : 'primary'}`} onClick={() => openPrice(line)}>{line.estimate ? 'Change price' : 'Price it'}</button>}
                    {!mineToPrice && line?.estimate && <button className="btn small ghost" onClick={() => openPrice(line)}>See price</button>}
                    {editable && <button className="closex" title="Remove this part" onClick={() => { const next = rows.filter((x) => x.key !== r.key); setRows(next); setDirty(true); void save(next); }}>×</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(editable || !!error) && (
        <div className="body row" style={{ borderTop: rows.length ? '1px solid var(--line)' : undefined }}>
          {editable && <button className="btn small" onClick={() => { setRows([...rows, blank()]); setDirty(true); }}>+ Add a part</button>}
          {dirty && <button className="btn small primary" onClick={() => save()}>Save parts</button>}
          <ErrorBanner error={error} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- files and conversation

function Files({ d, onChange }: { d: QuoteDetail; onChange: (n?: QuoteDetail) => void }) {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const closed = ['won', 'lost', 'no_bid'].includes(d.quote.status);
  const drop = async (files: File[]) => {
    setError(null);
    const said: string[] = [];
    const repeats: string[] = [];
    for (const f of files) {
      setBusy(`Reading ${f.name}…`);
      try {
        const r = await upload<DropResult>(`/quotes/${d.quote.id}/files`, f);
        const n = r.linesAdded.reduce((s, l) => s + l.lineIds.length, 0);
        const sheets = [...new Set(r.linesAdded.flatMap((l) => l.sheets))];
        if (n) said.push(`${n} part${n === 1 ? '' : 's'} from ${f.name}${sheets.length > 1 ? ` (sheets ${sheets.join(', ')})` : ''}`);
        const dup = r.linesAdded.reduce((s, l) => s + l.alreadyOnQuote, 0);
        if (dup) repeats.push(`${dup} part${dup === 1 ? '' : 's'} in ${f.name} ${dup === 1 ? 'was' : 'were'} already on the quote and not added again.`);
        if (r.fromEmail) said.push(`the email from ${r.fromEmail.from}${r.fromEmail.read.length ? `, and read from it ${r.fromEmail.read.join('; ')}` : ''}`);
        if (r.attachments.length > 1) said.push(`${r.attachments.length - 1} attachment${r.attachments.length === 2 ? '' : 's'}`);
      } catch (err) { setError(err); }
    }
    setBusy(null);
    if (said.length || repeats.length) app.toast([said.length ? `Added ${said.join(', ')}.` : '', ...repeats].filter(Boolean).join(' '));
    onChange();
  };
  return (
    <div className="section">
      <header><h2>Files</h2><span className="muted small">{d.attachments.length || ''}</span></header>
      <div className="body stack">
        {d.attachments.length > 0 && (
          <div className="files">
            {d.attachments.map((a) => (
              <div className="file" key={a.id}>
                <span className="ext">{a.fileName.split('.').pop()?.slice(0, 4)}</span>
                <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" title={`${a.fileName} · ${fileSize(a.sizeBytes)} · ${a.uploadedByName} ${ago(a.uploadedAt)}${a.source === 'email' ? ' · from the RFQ email' : ''}`}>{a.fileName}</a>
                <span className="muted small nowrap">{fileSize(a.sizeBytes)}</span>
                {!closed && <button className="closex x" title="Remove" onClick={async () => { try { await del(`/files/${a.id}`); onChange(); } catch (err) { setError(err); } }}>×</button>}
              </div>
            ))}
          </div>
        )}
        {!closed && <DropZone compact busy={busy} onFiles={drop} title="Drop files here" hint="Drawings, models, specs, emails, parts lists" />}
        <ErrorBanner error={error} />
      </div>
    </div>
  );
}

function Conversation({ d, onChange }: { d: QuoteDetail; onChange: (n: QuoteDetail) => void }) {
  const app = useApp();
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const myDept = app.account.role === 'estimator' ? d.requests.find((r) => r.department === app.account.department && r.status !== 'answered') : undefined;
  const [asking, setAsking] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  // Scrolls the thread, not the window: the newest message is in view without moving the page.
  useEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [d.messages.length]);
  const openQuestions = d.requests.filter((r) => r.status === 'question');
  return (
    <div className="section" id="conversation">
      <header><h2>Conversation</h2></header>
      <div className="body stack">
        <div className="thread" ref={thread}>
          {d.messages.map((m) => (
            <div key={m.id} className={`msg ${m.kind}`}>
              {m.kind === 'event' ? <span>{m.body} <span className="muted">· {ago(m.at)}</span></span> : (
                <>
                  <div className="meta"><b style={{ color: 'var(--ink-2)' }}>{m.authorName}</b>{m.kind === 'question' && m.department ? ` asked for ${app.deptName(m.department)}` : ''} · {ago(m.at)}</div>
                  <div className="text">{m.body}</div>
                </>
              )}
            </div>
          ))}
        </div>
        {openQuestions.length > 0 && canSell(app.account) && <div className="banner ask">Your reply answers {openQuestions.map((r) => app.deptName(r.department)).join(' and ')} and hands the quote back to them.</div>}
        <textarea placeholder={myDept ? `A note, or a question for ${d.quote.ownerName.split(' ')[0]}` : 'Write a note everyone on this quote sees'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          {myDept && <label className="row small"><input type="checkbox" checked={asking} onChange={(e) => setAsking(e.target.checked)} /> This is a question; {app.deptName(myDept.department)} waits for the answer</label>}
          <span className="grow" />
          <button className="btn small primary" disabled={!text.trim()} onClick={async () => {
            setError(null);
            try {
              onChange(await post(`/quotes/${d.quote.id}/messages`, { body: text, ...(asking && myDept ? { question: true, department: myDept.department } : {}) }));
              setText('');
              setAsking(false);
              app.refreshCounts();
            } catch (err) { setError(err); }
          }}>{asking ? 'Ask' : 'Post'}</button>
        </div>
        <ErrorBanner error={error} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

/**
 * The quote's title, edited in place: it wraps and grows to show a long title whole, and Enter saves it
 * as leaving the field does (a title is one line of text).
 */
function TitleField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <textarea ref={ref} className="title-field" rows={1} defaultValue={value} aria-label="Quote title" placeholder="What is the customer asking for?"
      onInput={fit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      onBlur={(e) => onSave(e.target.value.replace(/\s*\n+\s*/g, ' ').trim())} />
  );
}

export function QuotePage({ id }: { id: number }) {
  const app = useApp();
  const { data, error, reload } = useAsync(() => get<QuoteDetail>(`/quotes/${id}`), [id]);
  const [d, setD] = useState<QuoteDetail | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pricing, setPricing] = useState<Line | null>(null);
  const [partsDirty, setPartsDirty] = useState(false);
  const customers = useAsync(() => get<{ id: number; name: string }[]>('/customers'), []);
  useEffect(() => { if (data) setD(data); }, [data]);
  const refresh = (n?: QuoteDetail) => { if (n) setD(n); else reload(); };

  const seller = canSell(app.account);
  const q = d?.quote;
  const closed = !!q && ['won', 'lost', 'no_bid'].includes(q.status);
  const deleted = !!q?.deletedAt;
  const editableHeader = seller && !closed && !deleted;
  const editableParts = seller && !!q && !deleted && (q.status === 'draft' || q.status === 'estimating');
  // How soon the customer's date is, inside its field: only when it is near or past (the date says the rest).
  const dueOn = q?.customerDueOn ?? null;
  const dueNote = dueOn && !closed && q?.status !== 'sent' && daysUntil(dueOn) <= 14
    ? <span className={`field-note ${dueTone(dueOn)}`}>{dueWords(dueOn)}</span> : null;
  const [deleting, setDeleting] = useState(false);
  const restore = async () => {
    setActionError(null);
    try { setD(await post<QuoteDetail>(`/quotes/${id}/restore`)); app.toast(`${q?.number} restored.`); app.refreshCounts(); } catch (err) { setActionError(err); }
  };
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const save = async (change: Record<string, unknown>) => {
    setActionError(null);
    setSaveState('saving');
    try { setD(await patch(`/quotes/${id}`, change)); setSaveState('saved'); } catch (err) { setActionError(err); setSaveState('error'); }
  };
  const customerList = useMemo(() => customers.data ?? [], [customers.data]);

  if (error) return <div className="page"><ErrorBanner error={error} /></div>;
  if (!d || !q) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <div className="qhead">
        <div>
          <div className="number">
            <a href="#/">Quotes</a> / <span className="mono">{q.number}{q.revision ? ` rev ${q.revision}` : ''}</span>
            {q.itar && <span className="chip itar">ITAR</span>}
            <span className="chip">{STAGE_NAMES[d.stage]}</span>
            {editableHeader && <SaveStatus state={saveState} dirty={partsDirty} />}
          </div>
          <h1>{editableHeader
            ? <TitleField value={q.title} key={`t${q.updatedAt}`} onSave={(v) => v !== q.title && save({ title: v })} />
            : (q.title || 'Untitled quote')}</h1>
          {q.sourceEmail && <div className="muted small">From the email “{q.sourceEmail.subject}” · {q.sourceEmail.from}</div>}
        </div>
        <div className="row">
          {d.stage !== 'draft' && !deleted && <a className="btn" href={`#/quotes/${id}/send`}>{d.stage === 'ready' ? 'Review and send' : 'Prices'}</a>}
          {seller && !deleted && q.status !== 'won' && <button className="btn ghost" onClick={() => setDeleting(true)}>Delete quote</button>}
        </div>
      </div>
      {deleted && (
        <div className="banner warn row" style={{ justifyContent: 'space-between' }}>
          <span><b>Deleted</b>{q.deletedByName ? ` by ${q.deletedByName}` : ''}{q.deletedAt ? `, ${shortDate(q.deletedAt)}` : ''}{q.deleteReason ? `: ${q.deleteReason}` : ''}. It is off the board and every queue.</span>
          {seller && <button className="btn small" onClick={() => void restore()}>Restore</button>}
        </div>
      )}
      {deleting && <DeleteDialog d={d} onClose={() => setDeleting(false)} />}
      <Steps d={d} />
      <ErrorBanner error={actionError} />
      {!deleted && <NextStep d={d} lines={d.lines} reload={refresh} setError={setActionError} dirty={partsDirty} />}

      <div className="layout">
        <div className="stack">
          <div className="section">
            <div className="body">
              <div className="grid3 head-grid">
                <label className="field">Customer
                  {editableHeader ? (
                    <>
                      <input list="customers" defaultValue={q.customerName ?? ''} key={`c${q.customerName}`} placeholder="Type a name — new ones are added"
                        onBlur={(e) => e.target.value.trim() !== (q.customerName ?? '') && save({ customerName: e.target.value })} />
                      <datalist id="customers">{customerList.map((c) => <option key={c.id} value={c.name} />)}</datalist>
                    </>
                  ) : <span className="value">{q.customerName ?? '—'}</span>}
                </label>
                <label className="field">Contact
                  {editableHeader ? <input defaultValue={q.contactName ?? ''} key={`n${q.updatedAt}`} onBlur={(e) => e.target.value !== (q.contactName ?? '') && save({ contactName: e.target.value })} />
                    : <span className="value">{q.contactName ?? '—'}</span>}
                </label>
                <label className="field">Contact email
                  {editableHeader ? <input type="email" defaultValue={q.contactEmail ?? ''} key={`e${q.updatedAt}`} onBlur={(e) => e.target.value !== (q.contactEmail ?? '') && save({ contactEmail: e.target.value })} />
                    : <span className="value">{q.contactEmail ? <a href={`mailto:${q.contactEmail}`}>{q.contactEmail}</a> : '—'}</span>}
                </label>
                <label className="field">RFQ received
                  {editableHeader ? <DateField value={q.rfqReceivedOn} onSave={(v) => save({ rfqReceivedOn: v })} />
                    : <span className="value">{shortDate(q.rfqReceivedOn) || '—'}</span>}
                </label>
                <label className="field">Customer wants it by
                  {editableHeader
                    ? <span className={`with-note${dueNote ? ' has-note' : ''}`}><DateField value={q.customerDueOn} onSave={(v) => save({ customerDueOn: v })} />{dueNote}</span>
                    : <span className="value">{shortDate(q.customerDueOn) || '—'}{dueNote}</span>}
                </label>
                <label className="field">Business development
                  {editableHeader ? <OwnerPicker value={q.ownerId} onChange={(ownerId) => save({ ownerId })} /> : <span className="value">{q.ownerName}</span>}
                </label>
              </div>
              <div className="grid3" style={{ marginTop: 14 }}>
                <div className="field span2">
                  <span>Quantities (assemblies)</span>
                  <Quantities value={q.quantities} disabled={!editableParts} onChange={(quantities) => save({ quantities })} />
                </div>
                <div className="field">
                  <span>Export control</span>
                  <label className="field-check">
                    <input type="checkbox" checked={q.itar} disabled={!editableHeader} onChange={(e) => save({ itar: e.target.checked })} /> ITAR controlled
                  </label>
                </div>
              </div>
            </div>
          </div>
          <Parts d={d} editable={editableParts} onSaved={setD} onDirty={setPartsDirty} onSaveState={setSaveState} openPrice={setPricing} />
          {d.requests.length > 0 && (
            <div className="row wrap small">
              <span className="muted">Departments:</span>
              {d.requests.map((r) => <DeptChip key={r.id} dept={r.department} status={r.status} />)}
            </div>
          )}
        </div>
        <div className="stack">
          <Files d={d} onChange={refresh} />
          <Conversation d={d} onChange={setD} />
        </div>
      </div>
      {pricing && <PricePanel key={pricing.id} d={d} line={d.lines.find((l) => l.id === pricing.id) ?? pricing} onClose={() => setPricing(null)} onSaved={() => { reload(); app.refreshCounts(); }} />}
    </div>
  );
}

function OwnerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const people = useAsync(() => get<{ id: string; displayName: string; role: string }[]>('/people'), []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {(people.data ?? []).filter((p) => p.role !== 'estimator' || p.id === value).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
      {!people.data && <option value={value}>…</option>}
    </select>
  );
}

