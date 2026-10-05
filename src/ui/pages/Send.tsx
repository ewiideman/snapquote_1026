// Review and send: every price on one page, business development's own prices with their reasons,
// the customer's copy, and the outcome.
import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { Line, QuoteDetail, SheetCell } from '../lib/types.ts';
import { STAGE_NAMES } from '../lib/types.ts';
import { canSell, DeptChip, Dialog, ErrorBanner, NumberInput, useApp } from '../components/ui.tsx';
import { qty, shortDate, usd } from '../lib/format.ts';
import { CloseDialog } from './Quote.tsx';
import { caughtUpWords, loadTone, pct, type CapacityRead, type WorkCellCapacity } from '../lib/capacity.ts';
import { ago } from '../lib/format.ts';
import { PricePanel } from './PricePanel.tsx';

function PriceCell({ cell, editable, onEdit }: { cell: SheetCell; editable: boolean; onEdit: () => void }) {
  const body = cell.unitPrice === null ? <span>missing</span> : (
    <>
      {cell.override !== null && cell.estimated !== null && <span className="was">{usd(cell.estimated)}</span>}
      <span className={cell.override !== null ? 'ov' : ''} title={cell.overrideReason ?? undefined}>{usd(cell.unitPrice)}</span>
    </>
  );
  return (
    <td className={`price${cell.unitPrice === null ? ' missing' : ''}`}>
      {editable ? <button className="pricebtn" onClick={onEdit} title="Set your own price">{body}</button> : body}
    </td>
  );
}

function OverrideDialog({ line, cell, onClose, onDone }: { line: Line; cell: SheetCell; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState<number | null>(cell.override ?? cell.estimated);
  const [reason, setReason] = useState(cell.overrideReason ?? '');
  const [error, setError] = useState<unknown>(null);
  const send = async (unitPrice: number | null) => {
    try {
      await put(`/lines/${line.id}/override`, { quantity: cell.quantity, unitPrice, reason });
      onDone();
    } catch (err) { setError(err); }
  };
  const change = cell.estimated && price !== null ? (price - cell.estimated) / cell.estimated : null;
  return (
    <Dialog title={`${line.partNumber || line.description} at ${qty(cell.quantity)}`} onClose={onClose} footer={
      <>
        {cell.override !== null && <button className="btn ghost" onClick={() => send(null)}>Back to the department's price</button>}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={price === null || !reason.trim()} onClick={() => send(price)}>Use my price</button>
      </>
    }>
      <p className="muted">{cell.estimated !== null ? `The department priced it at ${usd(cell.estimated)} each.` : 'The department has not priced this yet.'}</p>
      <div className="grid2">
        <label className="field">Your price each ($)<NumberInput value={price} onChange={setPrice} /></label>
        <div className="field" style={{ justifyContent: 'flex-end', fontSize: 13, display: 'flex', flexDirection: 'column' }}>
          {change !== null && Math.abs(change) > 0.0001 && <span style={{ color: change < 0 ? 'var(--late)' : 'var(--done)' }}>{change > 0 ? '+' : ''}{(change * 100).toFixed(1)}% against the department</span>}
        </div>
      </div>
      <label className="field">Why (everyone on the quote sees this)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Match the 2025 price; volume commitment" autoFocus /></label>
      <ErrorBanner error={error} />
    </Dialog>
  );
}

interface QuoteCapacity {
  read: CapacityRead;
  quantities: number[];
  rows: { workCell: string; partNumber: string | null; ownQuantities: number[] | null; facilities: string[] | null; hours: number[]; capacity: WorkCellCapacity | null }[];
  withoutHours: { department: string; partNumber: string; reason: string }[];
}

/** Can the plant make it: this quote's Metals hours against the Production Scheduler's load on the same machines. */
function PlantCapacity({ id, version }: { id: number; version: string }) {
  const { data } = useAsync(() => get<QuoteCapacity>(`/quotes/${id}/capacity`), [id, version]);
  if (!data || (data.rows.length === 0 && data.withoutHours.length === 0)) return null;
  const read = data.read;
  const file = read.connected ? read.file : null;
  const metals = file?.departments.find((x) => x.key === 'metals');
  return (
    <div className="section" style={{ marginBottom: 16 }}>
      <header>
        <h2>Can the plant make it?</h2>
        <span className="muted small">{metals ? `Metals load from the Production Scheduler (${metals.scheduleName}), written ${ago(file?.writtenAt ?? '')}` : ''}</span>
      </header>
      {!read.connected && <div className="body"><div className="banner info">This server is not linked to the Production Scheduler, so only the hours are shown.</div></div>}
      {read.connected && !file && <div className="body"><div className="banner warn">{read.problem}</div></div>}
      {data.rows.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Work cell</th>
              {data.quantities.map((q) => <th key={q} className="right">Hours at {qty(q)}</th>)}
              <th className="right">Its hours a week</th><th className="right">Load</th><th>Late work</th><th className="right">Biggest quantity is</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const c = r.capacity;
              const biggest = r.hours[r.hours.length - 1] ?? 0;
              return (
                <tr key={`${r.workCell}|${r.partNumber ?? ''}`}>
                  <td><b>{r.workCell}</b>
                    <div className="sub">{r.facilities === null ? 'not tied to an XA facility yet' : r.facilities.length === 0 ? 'not a scheduled facility' : r.facilities.join(', ')}{r.partNumber ? ` · ${r.partNumber} at its own quantities (${(r.ownQuantities ?? []).map(qty).join(', ')})` : ''}</div>
                  </td>
                  {r.ownQuantities ? <td colSpan={data.quantities.length} className="right">{r.hours.map((h) => qty(h)).join(' / ')}</td> : data.quantities.map((q, i) => <td key={q} className="right">{qty(r.hours[i] ?? 0)}</td>)}
                  <td className="right">{c ? qty(c.hoursPerWeek) : ''}</td>
                  <td className="right">{c ? <span className={`chip ${loadTone(c.load) === 'ok' ? '' : loadTone(c.load)}`}>{pct(c.load)}</span> : ''}</td>
                  <td className="small">{c && file ? caughtUpWords(c, file.horizonWeeks) : ''}</td>
                  <td className="right small">{c && c.hoursPerWeek > 0 ? `${qty(Math.round((biggest / c.efficiency / c.hoursPerWeek) * 100) / 100)} wk of it` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="body muted small stack" style={{ gap: 4 }}>
        <span>Hours are standard hours from the Metals calculator: each operation's setup once, plus run time per piece. The scheduler's hours are clock hours, so a quote's hours are divided by the work cell's efficiency (0.85 in Metals) before they are set against them. Load is late work plus the next six weeks, against six weeks of the schedule's hours. The quote is not in the schedule; it is shown beside it.</span>
        {data.withoutHours.length > 0 && <span>No hours for {data.withoutHours.map((w) => `${w.partNumber} (${w.reason})`).join(', ')}.</span>}
        {data.rows.some((r) => r.facilities === null) && <span>A work cell not tied to its XA facility yet can be tied under Work cells.</span>}
      </div>
    </div>
  );
}

export function SendPage({ id }: { id: number }) {
  const app = useApp();
  const { data, error, reload } = useAsync(() => get<QuoteDetail>(`/quotes/${id}`), [id]);
  const [d, setD] = useState<QuoteDetail | null>(null);
  const [editing, setEditing] = useState<{ line: Line; cell: SheetCell } | null>(null);
  const [viewing, setViewing] = useState<Line | null>(null);
  const [closing, setClosing] = useState<null | 'won' | 'lost' | 'no_bid'>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  useEffect(() => { if (data) setD(data); }, [data]);
  if (error) return <div className="page"><ErrorBanner error={error} /></div>;
  if (!d) return <div className="page muted">Loading…</div>;

  const q = d.quote;
  const seller = canSell(app.account);
  const editable = seller && (q.status === 'estimating' || q.status === 'draft');
  const lines = d.lines.map((l, i) => ({ line: l, sheet: d.sheet.lines[i] }));
  const assembly = d.sheet.assembly;
  const waiting = d.requests.filter((r) => r.status !== 'answered');
  const overrides = d.overrides.length;
  const run = async (fn: () => Promise<QuoteDetail>) => {
    setActionError(null);
    try { setD(await fn()); app.refreshCounts(); } catch (err) { setActionError(err); }
  };

  return (
    <div className="page">
      <div className="qhead">
        <div>
          <div className="number"><a href="#/">Quotes</a> / <a className="mono" href={`#/quotes/${id}`}>{q.number}{q.revision ? ` rev ${q.revision}` : ''}</a> / Review and send <span className="chip">{STAGE_NAMES[d.stage]}</span></div>
          <h1>{q.customerName ?? 'No customer'} <span className="muted" style={{ fontWeight: 400 }}>· {q.title || 'Untitled'}</span></h1>
        </div>
        <div className="row">
          <a className="btn" href={`#/quotes/${id}`}>Back to the quote</a>
        </div>
      </div>

      {waiting.length > 0 && q.status === 'estimating' && (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          Still waiting on {waiting.map((r) => app.deptName(r.department)).join(', ')}. Prices below are what has come in so far.
        </div>
      )}
      <ErrorBanner error={actionError} />

      <div className="totals" style={{ marginBottom: 16 }}>
        {assembly ? assembly.map((b) => (
          <div key={b.quantity}><b>{b.unitPrice === null ? '—' : usd(b.unitPrice)}</b><span>each at {qty(b.quantity)} · {b.extended === null ? 'incomplete' : usd(b.extended, 0)}</span></div>
        )) : <div><b>{lines.length}</b><span>separate parts, priced each</span></div>}
        <div><b>{d.sheet.oneTimeTotal ? usd(d.sheet.oneTimeTotal, 0) : '—'}</b><span>One-time charges</span></div>
        <div><b>{d.sheet.leadTimeWeeks === null ? '—' : `${qty(d.sheet.leadTimeWeeks)} wk`}</b><span>Longest lead time</span></div>
      </div>

      <div className="section sheet" style={{ marginBottom: 16 }}>
        <header>
          <h2>Prices</h2>
          <span className="muted small">{editable ? 'Click a price to set your own. ' : ''}{overrides ? `${overrides} of your own price${overrides === 1 ? '' : 's'}, in blue.` : ''}</span>
        </header>
        {assembly ? (
          <table className="grid">
            <thead>
              <tr><th>Part</th><th>Priced by</th><th className="right tight">Qty per assembly</th>{q.quantities.map((b) => <th key={b} className="right">at {qty(b)}</th>)}<th className="right">One-time</th><th className="right">Lead</th></tr>
            </thead>
            <tbody>
              {lines.map(({ line, sheet }) => sheet && (
                <tr key={line.id}>
                  <td><span className="mono">{line.partNumber}</span>{line.revision && <span className="muted"> rev {line.revision}</span>}<div className="sub">{line.description}</div></td>
                  <td className="tight"><button className="link small" onClick={() => setViewing(line)}>{app.deptName(line.department)}</button></td>
                  <td className="right tight">{qty(line.qtyPer)}</td>
                  {sheet.cells.map((c) => <PriceCell key={c.quantity} cell={c} editable={editable} onEdit={() => setEditing({ line, cell: c })} />)}
                  <td className="price">{sheet.oneTimeCost ? usd(sheet.oneTimeCost, 0) : ''}</td>
                  <td className="price">{sheet.leadTimeWeeks === null ? '' : `${qty(sheet.leadTimeWeeks)} wk`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3}>Per assembly</td>{assembly.map((b) => <td key={b.quantity} className="price">{usd(b.unitPrice)}</td>)}<td className="price">{d.sheet.oneTimeTotal ? usd(d.sheet.oneTimeTotal, 0) : ''}</td><td /></tr>
              <tr><td colSpan={3}>Order value</td>{assembly.map((b) => <td key={b.quantity} className="price">{b.extended === null ? '—' : usd(b.extended, 0)}</td>)}<td /><td /></tr>
            </tfoot>
          </table>
        ) : (
          <table className="grid">
            <thead><tr><th>Part</th><th>Priced by</th><th className="right">Quantity</th><th className="right">Each</th><th className="right">Extended</th><th className="right">One-time</th></tr></thead>
            <tbody>
              {lines.flatMap(({ line, sheet }) => (sheet?.cells ?? []).map((c, i) => (
                <tr key={`${line.id}-${c.quantity}`}>
                  {i === 0 && <td rowSpan={sheet?.cells.length}><span className="mono">{line.partNumber}</span><div className="sub">{line.description}</div></td>}
                  {i === 0 && <td rowSpan={sheet?.cells.length} className="tight"><button className="link small" onClick={() => setViewing(line)}>{app.deptName(line.department)}</button></td>}
                  <td className="right">{qty(c.quantity)}</td>
                  <PriceCell cell={c} editable={editable} onEdit={() => setEditing({ line, cell: c })} />
                  <td className="price">{c.extended === null ? '' : usd(c.extended, 2)}</td>
                  {i === 0 && <td rowSpan={sheet?.cells.length} className="price">{sheet?.oneTimeCost ? usd(sheet.oneTimeCost, 0) : ''}</td>}
                </tr>
              )))}
            </tbody>
          </table>
        )}
      </div>

      <PlantCapacity id={id} version={d.quote.updatedAt} />

      {d.overrides.length > 0 && (
        <div className="section" style={{ marginBottom: 16 }}>
          <header><h2>Your prices</h2></header>
          <div className="body stack" style={{ gap: 6 }}>
            {d.overrides.map((o) => {
              const l = d.lines.find((x) => x.id === o.lineId);
              return <div key={`${o.lineId}-${o.quantity}`} className="small"><span className="mono">{l?.partNumber}</span> at {qty(o.quantity)}: <b>{usd(o.unitPrice)}</b> — {o.reason} <span className="muted">({o.setByName})</span></div>;
            })}
          </div>
        </div>
      )}

      {seller && (
        <div className="next">
          {q.status === 'estimating' || q.status === 'draft' ? (
            <>
              <p><b>{d.sheet.complete ? 'Ready for the customer.' : 'Not every part has a price yet.'}</b>
                <span className="muted">{d.sheet.complete ? 'Look over their copy, send it from your email as usual, then mark it sent here.' : `${d.sheet.missing.length} part${d.sheet.missing.length === 1 ? '' : 's'} still need a price.`}</span></p>
              <a className={`btn${d.sheet.complete ? '' : ' disabled'}`} href={d.sheet.complete ? `/api/quotes/${id}/pdf` : undefined} target="_blank" rel="noreferrer" aria-disabled={!d.sheet.complete}>Preview their copy</a>
              <a className="btn" href={d.sheet.complete ? `/api/quotes/${id}/pdf?download=1` : undefined} aria-disabled={!d.sheet.complete}>Download PDF</a>
              <button className="btn primary" disabled={!d.sheet.complete || q.status !== 'estimating'} onClick={() => setConfirmSent(true)}>Mark as sent</button>
            </>
          ) : q.status === 'sent' ? (
            <>
              <p><b>Sent to {q.customerName} on {shortDate(q.sentAt)}.</b><span className="muted">Record what they decided.</span></p>
              <a className="btn" href={`/api/quotes/${id}/pdf?download=1`}>Download PDF</a>
              <button className="btn primary" onClick={() => setClosing('won')}>Won</button>
              <button className="btn" onClick={() => setClosing('lost')}>Lost</button>
            </>
          ) : (
            <p><b>{STAGE_NAMES[d.stage]}.</b><span className="muted">{q.closeReason ?? ''}</span></p>
          )}
          {(q.status === 'estimating' || q.status === 'draft') && <button className="btn ghost" onClick={() => setClosing('no_bid')}>No bid</button>}
        </div>
      )}
      {d.requests.length > 0 && <div className="row wrap small" style={{ marginTop: 12 }}><span className="muted">Departments:</span>{d.requests.map((r) => <DeptChip key={r.id} dept={r.department} status={r.status} />)}</div>}

      {editing && <OverrideDialog line={editing.line} cell={editing.cell} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {viewing && <PricePanel d={d} line={viewing} onClose={() => setViewing(null)} onSaved={reload} />}
      {closing && <CloseDialog d={d} outcome={closing} onClose={() => setClosing(null)} onDone={(n) => { setClosing(null); setD(n); app.refreshCounts(); }} />}
      {confirmSent && (
        <Dialog title="Mark as sent?" onClose={() => setConfirmSent(false)} footer={<>
          <button className="btn" onClick={() => setConfirmSent(false)}>Not yet</button>
          <button className="btn primary" onClick={() => { setConfirmSent(false); void run(() => post(`/quotes/${id}/sent`)); }}>It's sent</button>
        </>}>
          <p>Prices are fixed once it is sent. If {q.customerName} asks for a change, open a revision from the quote.</p>
        </Dialog>
      )}
    </div>
  );
}
