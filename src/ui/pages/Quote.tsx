// One quote on one page: what the customer asked for, who is pricing it, the files, the conversation,
// and the one thing to do next. Business development edits it; a department prices its own parts here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, patch, post, put, upload, del } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { DepartmentKey, DropResult, Line, QuoteDetail } from '../lib/types.ts';
import { STAGE_NAMES } from '../lib/types.ts';
import { canEstimate, canSell, DeptChip, DropZone, Due, ErrorBanner, useApp } from '../components/ui.tsx';
import { ago, fileSize, qty, shortDate, usd } from '../lib/format.ts';
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

// ---------------------------------------------------------------- steps and the next thing to do

function Steps({ d }: { d: QuoteDetail }) {
  const order = ['draft', 'estimating', 'ready', 'sent', 'closed'] as const;
  const now = d.stage === 'won' || d.stage === 'lost' || d.stage === 'no_bid' ? 'closed' : d.stage;
  const idx = order.indexOf(now);
  const labels: Record<(typeof order)[number], string> = { draft: 'Put together', estimating: 'Departments price it', ready: 'Review and send', sent: 'With the customer', closed: 'Outcome' };
  const subs: Partial<Record<(typeof order)[number], string>> = {
    estimating: d.requests.length ? `${d.requests.filter((r) => r.status === 'answered').length} of ${d.requests.length} priced` : '',
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
  const run = async (fn: () => Promise<QuoteDetail>) => {
    setError(null);
    try { reload(await fn()); app.refreshCounts(); } catch (err) { setError(err); }
  };
  const myRequest = d.requests.find((r) => canEstimate(app.account, r.department) && app.account.role === 'estimator');

  if (myRequest && d.quote.status === 'estimating') {
    const mine = d.lines.filter((l) => l.department === myRequest.department);
    const priced = mine.filter((l) => l.estimate && l.pieceQuantities.every((q) => l.estimate?.prices.some((p) => Math.abs(p.quantity - q) < 0.005))).length;
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
          <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </label>
        <button className="btn primary" disabled={problems.length > 0 || dirty} onClick={() => run(() => post(`/quotes/${d.quote.id}/send-to-estimating`, { neededBy: neededBy || null }))}>Send to the departments</button>
      </div>
    );
  }
  if (d.stage === 'estimating') {
    const questions = d.requests.filter((r) => r.status === 'question');
    const waiting = d.requests.filter((r) => r.status === 'open');
    if (questions.length) {
      return <div className="next" style={{ borderColor: 'var(--ask-line)', boxShadow: '0 0 0 3px var(--ask-soft)' }}><p><b>{questions.map((r) => app.deptName(r.department)).join(' and ')} asked you something.</b><span className="muted">Answer in the conversation; your reply sends it back to them.</span></p><a className="btn" href="#conversation">Answer</a></div>;
    }
    return (
      <div className="next calm">
        <p><b>Waiting on {waiting.map((r) => app.deptName(r.department)).join(', ')}.</b>
          <span className="muted">You can still change the parts; a department whose parts change gets the quote back.</span></p>
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
          <button className="btn ghost" onClick={async () => { const reason = prompt('What did the customer ask to change?'); if (reason !== null) await run(() => post(`/quotes/${d.quote.id}/revise`, { reason })); }}>Revise</button>
        </div>
        {closing && <CloseDialog d={d} outcome={closing} onClose={() => setClosing(null)} onDone={(n) => { setClosing(null); reload(n); app.refreshCounts(); }} />}
      </>
    );
  }
  return (
    <div className="next calm">
      <p><b>{STAGE_NAMES[d.stage]}{d.quote.closedAt ? ` on ${shortDate(d.quote.closedAt)}` : ''}.</b>
        <span className="muted">{[d.quote.closeReason, d.quote.poNumber ? `PO ${d.quote.poNumber}` : '', d.quote.awardAmount !== null ? usd(d.quote.awardAmount, 0) : ''].filter(Boolean).join(' · ')}</span></p>
      <button className="btn ghost" onClick={async () => { const reason = prompt('Why is it being reopened?'); if (reason !== null) await run(() => post(`/quotes/${d.quote.id}/revise`, { reason })); }}>Reopen as a revision</button>
    </div>
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

function Parts({ d, editable, onSaved, onDirty, openPrice }: { d: QuoteDetail; editable: boolean; onSaved: (n: QuoteDetail) => void; onDirty: (b: boolean) => void; openPrice: (l: Line) => void }) {
  const app = useApp();
  const [rows, setRows] = useState<Draft[]>(() => d.lines.map(toDraft));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);
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
    } catch (err) {
      pending.current = null;
      setError(err);
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
        <table className="grid edit">
          <thead>
            <tr>
              <th className="tight">#</th><th>Part number</th><th className="tight">Rev</th><th>Description</th>
              <th className="tight right" title="How many go into one assembly">Per assy</th><th>Priced by</th>
              {showPrices && <th className="tight right">{firstQty ? `Each at ${qty(firstQty)}` : 'Price'}</th>}
              <th className="tight" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const line = r.id ? byId.get(r.id) : undefined;
              const cell = r.id ? sheetById.get(r.id)?.cells[0] : undefined;
              const mineToPrice = !!line && d.quote.status === 'estimating' && canEstimate(app.account, line.department);
              return (
                <tr key={r.key} className={mineToPrice ? 'mine' : ''}>
                  <td className="tight muted" style={{ paddingLeft: 10 }}>{i + 1}</td>
                  <td>{editable ? <input className="bare mono" value={r.partNumber} placeholder="Part number" onChange={(e) => edit(r.key, { partNumber: e.target.value })} onBlur={() => dirty && save()} /> : <span className="mono">{r.partNumber}</span>}</td>
                  <td className="tight">{editable ? <input className="bare" style={{ width: 52 }} value={r.revision} onChange={(e) => edit(r.key, { revision: e.target.value })} onBlur={() => dirty && save()} /> : r.revision}</td>
                  <td>{editable ? <input className="bare" value={r.description} placeholder="Description" onChange={(e) => edit(r.key, { description: e.target.value })} onBlur={() => dirty && save()} /> : r.description}
                    {r.notes && <div className="sub" style={{ paddingLeft: editable ? 7 : 0 }}>{r.notes}</div>}
                    {r.quantities.length > 0 && <div className="sub" style={{ paddingLeft: editable ? 7 : 0 }}>Own quantities: {r.quantities.map(qty).join(', ')}</div>}
                  </td>
                  <td className="tight">{editable ? <input className="bare num" style={{ width: 64 }} value={String(r.qtyPer)} onChange={(e) => { const n = Number(e.target.value); if (n > 0) edit(r.key, { qtyPer: n }); }} onBlur={() => dirty && save()} /> : <span className="right">{qty(r.qtyPer)}</span>}</td>
                  <td>{editable ? (
                    <select className="bare" value={r.department ?? ''} onChange={(e) => edit(r.key, { department: (e.target.value || null) as DepartmentKey | null }, true)} style={!r.department ? { color: 'var(--late)' } : undefined}>
                      <option value="">Choose…</option>
                      {app.departments.map((dep) => <option key={dep.key} value={dep.key}>{dep.name}</option>)}
                    </select>
                  ) : app.deptName(r.department)}</td>
                  {showPrices && (
                    <td className="tight right">
                      {cell?.unitPrice !== null && cell?.unitPrice !== undefined ? <span className={cell.override !== null ? 'ov' : ''}>{usd(cell.unitPrice)}</span> : <span className="muted small">{line?.estimate ? '—' : 'not yet'}</span>}
                    </td>
                  )}
                  <td className="tight">
                    {mineToPrice && line && <button className={`btn small ${line.estimate ? '' : 'primary'}`} onClick={() => openPrice(line)}>{line.estimate ? 'Change price' : 'Price it'}</button>}
                    {!mineToPrice && line?.estimate && <button className="btn small ghost" onClick={() => openPrice(line)}>How priced</button>}
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
    for (const f of files) {
      setBusy(`Reading ${f.name}…`);
      try {
        const r = await upload<DropResult>(`/quotes/${d.quote.id}/files`, f);
        const n = r.linesAdded.reduce((s, l) => s + l.lineIds.length, 0);
        if (n) said.push(`${n} part${n === 1 ? '' : 's'} from ${f.name}`);
        if (r.fromEmail) said.push(`the email from ${r.fromEmail.from}`);
        if (r.attachments.length > 1) said.push(`${r.attachments.length - 1} attachment${r.attachments.length === 2 ? '' : 's'}`);
      } catch (err) { setError(err); }
    }
    setBusy(null);
    if (said.length) app.toast(`Added ${said.join(', ')}.`);
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
  const editableHeader = seller && !closed;
  const editableParts = seller && !!q && (q.status === 'draft' || q.status === 'estimating');
  const save = async (change: Record<string, unknown>) => {
    setActionError(null);
    try { setD(await patch(`/quotes/${id}`, change)); } catch (err) { setActionError(err); }
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
          </div>
          <h1>{editableHeader
            ? <input defaultValue={q.title} key={`t${q.updatedAt}`} placeholder="What is the customer asking for?" onBlur={(e) => e.target.value !== q.title && save({ title: e.target.value })} />
            : (q.title || 'Untitled quote')}</h1>
          {q.sourceEmail && <div className="muted small">From the email “{q.sourceEmail.subject}” · {q.sourceEmail.from}</div>}
        </div>
        <div className="row">
          {d.stage !== 'draft' && <a className="btn" href={`#/quotes/${id}/send`}>{d.stage === 'ready' ? 'Review and send' : 'Prices'}</a>}
        </div>
      </div>
      <Steps d={d} />
      <ErrorBanner error={actionError} />
      <NextStep d={d} lines={d.lines} reload={refresh} setError={setActionError} dirty={partsDirty} />

      <div className="layout">
        <div className="stack">
          <div className="section">
            <div className="body">
              <div className="grid3">
                <label className="field">Customer
                  {editableHeader ? (
                    <>
                      <input list="customers" defaultValue={q.customerName ?? ''} key={`c${q.customerName}`} placeholder="Type a name — new ones are added"
                        onBlur={(e) => e.target.value.trim() !== (q.customerName ?? '') && save({ customerName: e.target.value })} />
                      <datalist id="customers">{customerList.map((c) => <option key={c.id} value={c.name} />)}</datalist>
                    </>
                  ) : <span style={{ color: 'var(--ink)', fontSize: 14 }}>{q.customerName ?? '—'}</span>}
                </label>
                <label className="field">Contact
                  {editableHeader ? <input defaultValue={q.contactName ?? ''} key={`n${q.updatedAt}`} onBlur={(e) => e.target.value !== (q.contactName ?? '') && save({ contactName: e.target.value })} />
                    : <span style={{ color: 'var(--ink)', fontSize: 14 }}>{q.contactName ?? '—'}</span>}
                </label>
                <label className="field">Contact email
                  {editableHeader ? <input type="email" defaultValue={q.contactEmail ?? ''} key={`e${q.updatedAt}`} onBlur={(e) => e.target.value !== (q.contactEmail ?? '') && save({ contactEmail: e.target.value })} />
                    : <span style={{ color: 'var(--ink)', fontSize: 14 }}>{q.contactEmail ? <a href={`mailto:${q.contactEmail}`}>{q.contactEmail}</a> : '—'}</span>}
                </label>
                <label className="field">RFQ received
                  {editableHeader ? <input type="date" defaultValue={q.rfqReceivedOn ?? ''} key={`r${q.updatedAt}`} onChange={(e) => save({ rfqReceivedOn: e.target.value || null })} />
                    : <span style={{ color: 'var(--ink)', fontSize: 14 }}>{shortDate(q.rfqReceivedOn) || '—'}</span>}
                </label>
                <label className="field"><span>Customer wants it by {!closed && q.status !== 'sent' && <Due date={q.customerDueOn} />}</span>
                  {editableHeader ? <input type="date" defaultValue={q.customerDueOn ?? ''} key={`d${q.updatedAt}`} onChange={(e) => save({ customerDueOn: e.target.value || null })} />
                    : <span style={{ color: 'var(--ink)', fontSize: 14 }}>{shortDate(q.customerDueOn) || '—'}</span>}
                </label>
                <label className="field">Business development
                  {editableHeader ? <OwnerPicker value={q.ownerId} onChange={(ownerId) => save({ ownerId })} /> : <span style={{ color: 'var(--ink)', fontSize: 14 }}>{q.ownerName}</span>}
                </label>
              </div>
              <div className="row wrap" style={{ marginTop: 14, alignItems: 'flex-start', gap: 24 }}>
                <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--muted)', fontWeight: 550 }}>
                  Quantities (assemblies)
                  <Quantities value={q.quantities} disabled={!editableParts} onChange={(quantities) => save({ quantities })} />
                </div>
                <label className="row small" style={{ marginTop: 22 }}>
                  <input type="checkbox" checked={q.itar} disabled={!editableHeader} onChange={(e) => save({ itar: e.target.checked })} /> ITAR controlled
                </label>
              </div>
            </div>
          </div>
          <Parts d={d} editable={editableParts} onSaved={setD} onDirty={setPartsDirty} openPrice={setPricing} />
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
      {pricing && <PricePanel d={d} line={d.lines.find((l) => l.id === pricing.id) ?? pricing} onClose={() => setPricing(null)} onSaved={() => { reload(); app.refreshCounts(); }} />}
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

