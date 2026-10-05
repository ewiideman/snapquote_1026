// Pricing one part, from the side of the quote page. Metals works it out with its calculator,
// Procurement from vendor quotes, any department can type its prices. Everyone else sees how it was priced.
import { useEffect, useMemo, useRef, useState } from 'react';
import { del, get, post, put } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { Line, QuoteDetail } from '../lib/types.ts';
import { canEstimate, ErrorBanner, NumberInput, Panel, useApp } from '../components/ui.tsx';
import { ago, qty, usd } from '../lib/format.ts';

type Tab = 'calculator' | 'vendors' | 'manual';

export function PricePanel({ d, line, onClose, onSaved }: { d: QuoteDetail; line: Line; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const mine = d.quote.status === 'estimating' && canEstimate(app.account, line.department);
  const tabs: Tab[] = mine ? [...(line.department === 'metals' ? ['calculator' as const] : []), ...(line.department === 'procurement' ? ['vendors' as const] : []), 'manual'] : [];
  const [tab, setTab] = useState<Tab>(() => (line.estimate?.basis === 'manual' ? 'manual' : tabs[0] ?? 'manual'));
  const title = `${line.partNumber || line.description || `Part ${line.position}`}${line.revision ? ` rev ${line.revision}` : ''}`;
  const sub = `${line.description && line.partNumber ? `${line.description} · ` : ''}${app.deptName(line.department)} · ${line.pieceQuantities.map(qty).join(', ')} pieces${line.qtyPer !== 1 && !line.quantities.length ? ` (${qty(line.qtyPer)} per assembly)` : ''}`;
  const saved = () => { onSaved(); onClose(); app.toast(`Price saved for ${title}.`); };
  return (
    <Panel title={title} sub={sub} onClose={onClose}>
      {line.estimate && <EstimateSummary line={line} />}
      {mine && (
        <>
          {tabs.length > 1 && (
            <div className="tabs">
              {tabs.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'calculator' ? 'Metals calculator' : t === 'vendors' ? 'Vendor quotes' : 'Enter prices'}</button>)}
            </div>
          )}
          {tab === 'calculator' && <MetalsCalculator line={line} onSaved={saved} />}
          {tab === 'vendors' && <VendorQuotes line={line} onSaved={saved} />}
          {tab === 'manual' && <ManualPrices line={line} onSaved={saved} />}
        </>
      )}
      {!mine && !line.estimate && <div className="empty">Not priced yet.</div>}
    </Panel>
  );
}

function EstimateSummary({ line }: { line: Line }) {
  const e = line.estimate;
  if (!e) return null;
  const how = e.basis === 'calculator' ? 'with the Metals calculator' : e.basis === 'vendor_quote' ? `from ${e.detail?.supplier ?? 'a vendor'}'s quote` : 'entered by hand';
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <div className="spread"><b>Current price</b><span className="muted small">{e.enteredByName}, {how}, {ago(e.enteredAt)}</span></div>
      <table className="grid">
        <thead><tr><th className="right">Pieces</th><th className="right">Each</th><th className="right">Extended</th></tr></thead>
        <tbody>{e.prices.map((p) => <tr key={p.quantity}><td className="right">{qty(p.quantity)}</td><td className="right">{usd(p.unitPrice)}</td><td className="right">{usd(p.unitPrice * p.quantity, 2)}</td></tr>)}</tbody>
      </table>
      <div className="row wrap small muted">
        {e.oneTimeCost > 0 && <span>{e.oneTimeLabel || 'One-time'}: {usd(e.oneTimeCost, 2)}</span>}
        {e.leadTimeWeeks !== null && <span>Lead time {qty(e.leadTimeWeeks)} weeks</span>}
        {e.notes && <span>{e.notes}</span>}
      </div>
      {e.basis === 'calculator' && Array.isArray(e.detail?.breaks) && <MetalsBreakdown breaks={e.detail.breaks} warnings={e.detail.warnings ?? []} />}
    </div>
  );
}

// ---------------------------------------------------------------- by hand

function ManualPrices({ line, onSaved }: { line: Line; onSaved: () => void }) {
  const prior = line.estimate?.basis === 'manual' ? line.estimate : null;
  const [prices, setPrices] = useState<(number | null)[]>(() => line.pieceQuantities.map((q) => prior?.prices.find((p) => Math.abs(p.quantity - q) < 0.005)?.unitPrice ?? null));
  const [oneTime, setOneTime] = useState<number | null>(prior?.oneTimeCost || null);
  const [oneTimeLabel, setOneTimeLabel] = useState(prior?.oneTimeLabel ?? '');
  const [lead, setLead] = useState<number | null>(prior?.leadTimeWeeks ?? null);
  const [notes, setNotes] = useState(prior?.notes ?? '');
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="stack">
      <table className="grid">
        <thead><tr><th className="right">Pieces</th><th className="right">Price each</th><th className="right">Extended</th></tr></thead>
        <tbody>
          {line.pieceQuantities.map((q, i) => (
            <tr key={q}>
              <td className="right">{qty(q)}</td>
              <td className="right"><NumberInput aria-label={`Price each at ${q}`} style={{ width: 120 }} value={prices[i] ?? null} onChange={(v) => setPrices(prices.map((p, j) => (j === i ? v : p)))} placeholder="$" /></td>
              <td className="right muted">{prices[i] !== null && prices[i] !== undefined ? usd((prices[i] as number) * q, 2) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid3">
        <label className="field">One-time charge ($)<NumberInput value={oneTime} onChange={setOneTime} placeholder="0" /></label>
        <label className="field">For<input value={oneTimeLabel} onChange={(e) => setOneTimeLabel(e.target.value)} placeholder="Tooling, NRE, fixture…" /></label>
        <label className="field">Lead time (weeks)<NumberInput value={lead} onChange={setLead} /></label>
      </div>
      <label className="field">How you got there<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — what this price assumes" /></label>
      <ErrorBanner error={error} />
      <div className="row">
        <button className="btn primary" disabled={prices.some((p) => p === null)} onClick={async () => {
          setError(null);
          try {
            await put(`/lines/${line.id}/estimate`, { basis: 'manual', prices: line.pieceQuantities.map((q, i) => ({ quantity: q, unitPrice: prices[i] })), oneTimeCost: oneTime, oneTimeLabel, leadTimeWeeks: lead, notes });
            onSaved();
          } catch (err) { setError(err); }
        }}>Save price</button>
        {prices.some((p) => p === null) && <span className="muted small">Every quantity needs a price.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Procurement: vendor quotes

interface VendorQuote { id: number; supplierName: string; reference: string; moq: number | null; leadTimeWeeks: number | null; tooling: number; nre: number; notes: string; prices: { quantity: number; unitCost: number }[]; enteredByName: string; enteredAt: string }

function VendorQuotes({ line, onSaved }: { line: Line; onSaved: () => void }) {
  const list = useAsync(() => get<VendorQuote[]>(`/lines/${line.id}/vendor-quotes`), [line.id]);
  const suppliers = useAsync(() => get<{ id: number; name: string }[]>('/suppliers'), []);
  const prior = line.estimate?.basis === 'vendor_quote' ? line.estimate.inputs : null;
  const [chosen, setChosen] = useState<number | null>(prior?.vendorQuoteId ?? null);
  const [rates, setRates] = useState<{ scrapPct: number | null; freightPct: number | null; markupPct: number | null }>({ scrapPct: prior?.scrapPct ?? 0, freightPct: prior?.freightPct ?? 0, markupPct: prior?.markupPct ?? null });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const vq = (list.data ?? []).find((v) => v.id === chosen) ?? null;
  const preview = useMemo(() => {
    if (!vq) return [];
    const sorted = [...vq.prices].sort((a, b) => a.quantity - b.quantity);
    return line.pieceQuantities.map((q) => {
      const b = [...sorted].reverse().find((x) => x.quantity <= q);
      if (!b) return { q, cost: null, price: null };
      const s = (rates.scrapPct ?? 0) / 100;
      const price = (b.unitCost / (1 - s)) * (1 + (rates.freightPct ?? 0) / 100) * (1 + (rates.markupPct ?? 0) / 100);
      return { q, cost: b.unitCost, price };
    });
  }, [vq, rates, line.pieceQuantities]);
  return (
    <div className="stack">
      {(list.data ?? []).length === 0 && !adding && <div className="banner info">No vendor quotes yet. Add the first one below.</div>}
      {(list.data ?? []).length > 0 && (
        <div className="section">
          <table className="grid">
            <thead><tr><th /><th>Vendor</th><th>Prices</th><th className="right">MOQ</th><th className="right">Lead</th><th className="right">Tooling + NRE</th><th /></tr></thead>
            <tbody>
              {(list.data ?? []).map((v) => (
                <tr key={v.id} className="click" onClick={() => setChosen(v.id)}>
                  <td className="tight"><input type="radio" checked={chosen === v.id} onChange={() => setChosen(v.id)} aria-label={`Use ${v.supplierName}`} /></td>
                  <td><b>{v.supplierName}</b>{v.reference && <div className="sub">{v.reference}</div>}</td>
                  <td className="small">{v.prices.map((p) => `${qty(p.quantity)} @ ${usd(p.unitCost)}`).join(' · ')}</td>
                  <td className="tight right">{v.moq === null ? '' : qty(v.moq)}</td>
                  <td className="tight right">{v.leadTimeWeeks === null ? '' : `${qty(v.leadTimeWeeks)} wk`}</td>
                  <td className="tight right">{v.tooling + v.nre ? usd(v.tooling + v.nre, 0) : ''}</td>
                  <td className="tight"><button className="closex" title="Remove" onClick={async (e) => { e.stopPropagation(); await del(`/vendor-quotes/${v.id}`); list.reload(); }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? <AddVendorQuote line={line} suppliers={suppliers.data ?? []} onDone={(id) => { setAdding(false); list.reload(); if (id) setChosen(id); }} />
        : <div><button className="btn small" onClick={() => setAdding(true)}>+ Add a vendor quote</button></div>}
      {vq && (
        <div className="card pad stack">
          <b>Price from {vq.supplierName}</b>
          <div className="grid3">
            <label className="field">Scrap %<NumberInput value={rates.scrapPct} onChange={(v) => setRates({ ...rates, scrapPct: v })} /></label>
            <label className="field">Freight %<NumberInput value={rates.freightPct} onChange={(v) => setRates({ ...rates, freightPct: v })} /></label>
            <label className="field">Markup %<NumberInput value={rates.markupPct} onChange={(v) => setRates({ ...rates, markupPct: v })} placeholder="required" /></label>
          </div>
          <table className="grid">
            <thead><tr><th className="right">Pieces</th><th className="right">Vendor cost</th><th className="right">Price each</th></tr></thead>
            <tbody>{preview.map((p) => <tr key={p.q}><td className="right">{qty(p.q)}</td><td className="right">{usd(p.cost)}</td><td className="right">{p.price === null ? <span style={{ color: 'var(--late)' }}>below the vendor's lowest quantity</span> : usd(Math.round(p.price * 10000) / 10000)}</td></tr>)}</tbody>
          </table>
          {vq.tooling + vq.nre > 0 && <div className="small muted">Tooling and NRE of {usd(vq.tooling + vq.nre, 2)} are quoted as a one-time charge.</div>}
          <ErrorBanner error={error} />
          <div><button className="btn primary" disabled={rates.markupPct === null || preview.some((p) => p.price === null)} onClick={async () => {
            setError(null);
            try { await post(`/lines/${line.id}/price-from-vendor`, { vendorQuoteId: vq.id, scrapPct: rates.scrapPct ?? 0, freightPct: rates.freightPct ?? 0, markupPct: rates.markupPct }); onSaved(); } catch (err) { setError(err); }
          }}>Use this price</button></div>
        </div>
      )}
    </div>
  );
}

function AddVendorQuote({ line, suppliers, onDone }: { line: Line; suppliers: { id: number; name: string }[]; onDone: (id: number | null) => void }) {
  const [f, setF] = useState({ supplierName: '', reference: '', moq: null as number | null, leadTimeWeeks: null as number | null, tooling: null as number | null, nre: null as number | null, notes: '' });
  const [rows, setRows] = useState<{ quantity: number | null; unitCost: number | null }[]>(() => line.pieceQuantities.map((q) => ({ quantity: q, unitCost: null })));
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="card pad stack">
      <b>New vendor quote</b>
      <div className="grid2">
        <label className="field">Vendor<input list="suppliers" value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} autoFocus /></label>
        <datalist id="suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
        <label className="field">Their quote number<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      </div>
      <table className="grid">
        <thead><tr><th className="right">Quantity</th><th className="right">Cost each</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="right"><NumberInput style={{ width: 110 }} value={r.quantity} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} /></td>
              <td className="right"><NumberInput style={{ width: 110 }} value={r.unitCost} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, unitCost: v } : x)))} placeholder="$" /></td>
              <td className="tight"><button className="closex" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div><button className="btn small" onClick={() => setRows([...rows, { quantity: null, unitCost: null }])}>+ Another quantity</button></div>
      <div className="grid4">
        <label className="field">Minimum order<NumberInput value={f.moq} onChange={(v) => setF({ ...f, moq: v })} /></label>
        <label className="field">Lead time (weeks)<NumberInput value={f.leadTimeWeeks} onChange={(v) => setF({ ...f, leadTimeWeeks: v })} /></label>
        <label className="field">Tooling ($)<NumberInput value={f.tooling} onChange={(v) => setF({ ...f, tooling: v })} /></label>
        <label className="field">NRE ($)<NumberInput value={f.nre} onChange={(v) => setF({ ...f, nre: v })} /></label>
      </div>
      <ErrorBanner error={error} />
      <div className="row">
        <button className="btn primary" onClick={async () => {
          setError(null);
          try {
            const r = await post<{ id: number }>(`/lines/${line.id}/vendor-quotes`, { ...f, prices: rows.filter((x) => x.quantity !== null && x.unitCost !== null) });
            onDone(r.id);
          } catch (err) { setError(err); }
        }}>Add</button>
        <button className="btn ghost" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Metals: the calculator

interface WorkCell { name: string; hourlyCellRate: number; setUpTimeHours: number }
interface MaterialItem { itemNumber: string; description: string; priceUsd: number | null }
interface Op { workCell: string; setupHours: number | null; runMinutesPerPiece: number | null; name?: string }
interface Hw { label: string; quantity: number | null; unitCost: number | null }
interface Tool { label: string; amount: number | null }
interface Osp { description: string; unitPrice: number | null; lotCharge: number | null }

interface CalcState {
  laborOnly: boolean;
  itemNumber: string;
  unit: 'in' | 'mm';
  length: number | null;
  width: number | null;
  ops: Op[];
  hardware: Hw[];
  tooling: Tool[];
  osp: Osp[];
}

const MM = 25.4;

function fromInputs(inputs: any): CalcState {
  const blank = inputs?.blank ?? {};
  const unit: 'in' | 'mm' = inputs?.ui?.unit === 'mm' ? 'mm' : 'in';
  const conv = (mm: unknown) => (typeof mm === 'number' ? (unit === 'in' ? Math.round((mm / MM) * 1000) / 1000 : mm) : null);
  return {
    laborOnly: !!inputs?.laborOnly,
    itemNumber: inputs?.material?.itemNumber ?? '',
    unit,
    length: conv(blank.lengthMm),
    width: conv(blank.widthMm),
    ops: Array.isArray(inputs?.operations) && inputs.operations.length ? inputs.operations.map((o: any) => ({ workCell: o.workCell ?? '', setupHours: o.setupHours ?? null, runMinutesPerPiece: o.runMinutesPerPiece ?? null, name: o.name })) : [{ workCell: '', setupHours: null, runMinutesPerPiece: null }],
    hardware: (inputs?.hardware ?? []).map((h: any) => ({ label: h.label, quantity: h.quantity, unitCost: h.unitCost })),
    tooling: (inputs?.tooling?.items ?? []).map((t: any) => ({ label: t.label, amount: t.amount })),
    osp: (inputs?.outsideProcessing ?? []).map((o: any) => ({ description: o.description, unitPrice: o.unitPrice, lotCharge: o.lotCharge })),
  };
}

function toInputs(s: CalcState): any {
  const mm = (v: number | null) => (v === null ? undefined : s.unit === 'in' ? v * MM : v);
  return {
    ui: { unit: s.unit },
    ...(s.laborOnly ? { laborOnly: true } : { material: { itemNumber: s.itemNumber || undefined }, blank: { lengthMm: mm(s.length), widthMm: mm(s.width) } }),
    operations: s.ops.filter((o) => o.workCell).map((o) => ({ name: o.name ?? o.workCell, workCell: o.workCell, setupHours: o.setupHours ?? 0, runMinutesPerPiece: o.runMinutesPerPiece ?? 0 })),
    hardware: s.hardware.filter((h) => h.label && h.quantity).map((h) => ({ label: h.label, quantity: h.quantity ?? 0, unitCost: h.unitCost ?? 0 })),
    tooling: { items: s.tooling.filter((t) => t.label || t.amount).map((t) => ({ label: t.label || 'Tooling', amount: t.amount ?? 0 })) },
    outsideProcessing: s.osp.filter((o) => o.description).map((o) => ({ description: o.description, status: 'quoted', unitPrice: o.unitPrice, lotCharge: o.lotCharge, quantity: null })),
  };
}

function MetalsBreakdown({ breaks, warnings }: { breaks: any[]; warnings: string[] }) {
  const rows: [string, (b: any) => string][] = [
    ['Parts', (b) => qty(b.parts)],
    ['Parts per sheet', (b) => (b.nesting ? qty(b.nesting.partsPerSheet) : '—')],
    ['Material', (b) => usd(b.perPart.material)],
    ['Labor (setup + run)', (b) => usd(b.perPart.labor)],
    ['Programming', (b) => usd(b.perPart.programming)],
    ['Hardware', (b) => usd(b.perPart.hardware)],
    ['Tooling', (b) => usd(b.perPart.tooling)],
    ['Outside processing', (b) => usd(b.perPart.osp)],
  ];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <table className="grid">
        <thead><tr><th>Per part</th>{breaks.map((b) => <th key={b.parts} className="right">{qty(b.parts)}</th>)}</tr></thead>
        <tbody>
          {rows.filter(([label]) => label === 'Parts' || breaks.some((b) => {
            const v = rows.find((r) => r[0] === label)?.[1](b);
            return v !== '$0.00' && v !== '—';
          })).map(([label, f]) => <tr key={label}><td className="muted">{label}</td>{breaks.map((b) => <td key={b.parts} className="right">{f(b)}</td>)}</tr>)}
          <tr><td><b>Price each</b></td>{breaks.map((b) => <td key={b.parts} className="right"><b>{usd(b.unitPrice)}</b></td>)}</tr>
        </tbody>
      </table>
      {warnings.length > 0 && <div className="banner warn">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}
    </div>
  );
}

function MetalsCalculator({ line, onSaved }: { line: Line; onSaved: () => void }) {
  const catalog = useAsync(() => get<{ catalog: { workCells: WorkCell[]; materialItems: MaterialItem[] } }>('/metals/catalog'), []);
  const prior = line.estimate?.basis === 'calculator' ? line.estimate : null;
  const [s, setS] = useState<CalcState>(() => fromInputs(prior?.inputs));
  const [lead, setLead] = useState<number | null>(prior?.leadTimeWeeks ?? null);
  const [notes, setNotes] = useState(prior?.notes ?? '');
  const [result, setResult] = useState<{ result: { breaks: any[]; warnings: string[] }; problems: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [materialSearch, setMaterialSearch] = useState('');
  const seq = useRef(0);
  const cells = catalog.data?.catalog.workCells ?? [];
  const materials = catalog.data?.catalog.materialItems ?? [];
  const input = useMemo(() => toInputs(s), [s]);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await post(`/lines/${line.id}/metals`, { input });
        if (mine === seq.current) { setResult(r); setError(null); }
      } catch (err) { if (mine === seq.current) setError(err); }
    }, 350);
    return () => clearTimeout(t);
  }, [input, line.id]);

  const set = (change: Partial<CalcState>) => setS({ ...s, ...change });
  const material = materials.find((m) => m.itemNumber === s.itemNumber);
  const shownMaterials = materials.filter((m) => !materialSearch || `${m.itemNumber} ${m.description}`.toLowerCase().includes(materialSearch.toLowerCase())).slice(0, 200);

  return (
    <div className="stack">
      <div className="card pad stack">
        <div className="spread"><b>Material</b><label className="row small"><input type="checkbox" checked={s.laborOnly} onChange={(e) => set({ laborOnly: e.target.checked })} /> Labor only (no material of its own)</label></div>
        {!s.laborOnly && (
          <>
            <div className="grid2">
              <label className="field">Find a sheet<input placeholder="Item number, alloy or thickness" value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} /></label>
              <label className="field">Sheet
                <select value={s.itemNumber} onChange={(e) => set({ itemNumber: e.target.value })}>
                  <option value="">Choose a sheet…</option>
                  {material && !shownMaterials.includes(material) && <option value={material.itemNumber}>{material.itemNumber} — {material.description}</option>}
                  {shownMaterials.map((m) => <option key={m.itemNumber} value={m.itemNumber}>{m.itemNumber} — {m.description}{m.priceUsd !== null ? ` — ${usd(m.priceUsd, 2)}/sheet` : ' — no price'}</option>)}
                </select>
              </label>
            </div>
            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <label className="field">Blank length<NumberInput value={s.length} onChange={(v) => set({ length: v })} style={{ width: 110 }} /></label>
              <label className="field">Blank width<NumberInput value={s.width} onChange={(v) => set({ width: v })} style={{ width: 110 }} /></label>
              <div className="seg">{(['in', 'mm'] as const).map((u) => <button key={u} className={s.unit === u ? 'on' : ''} onClick={() => {
                const f = u === s.unit ? 1 : u === 'mm' ? MM : 1 / MM;
                const r = (v: number | null) => (v === null ? null : Math.round(v * f * 1000) / 1000);
                set({ unit: u, length: r(s.length), width: r(s.width) });
              }}>{u}</button>)}</div>
            </div>
          </>
        )}
      </div>

      <div className="card pad stack">
        <b>Operations</b>
        <table className="grid edit ops">
          <thead><tr><th>Work cell</th><th className="right">Setup (hours)</th><th className="right">Run (min / piece)</th><th className="right">Rate</th><th /></tr></thead>
          <tbody>
            {s.ops.map((o, i) => {
              const cell = cells.find((c) => c.name === o.workCell);
              const upd = (change: Partial<Op>) => set({ ops: s.ops.map((x, j) => (j === i ? { ...x, ...change } : x)) });
              return (
                <tr key={i}>
                  <td><select className="bare" value={o.workCell} onChange={(e) => { const c = cells.find((x) => x.name === e.target.value); upd({ workCell: e.target.value, ...(o.setupHours === null && c ? { setupHours: c.setUpTimeHours } : {}) }); }}>
                    <option value="">Choose…</option>
                    {cells.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select></td>
                  <td className="tight"><NumberInput className="bare" style={{ width: 90 }} value={o.setupHours} onChange={(v) => upd({ setupHours: v })} /></td>
                  <td className="tight"><NumberInput className="bare" style={{ width: 90 }} value={o.runMinutesPerPiece} onChange={(v) => upd({ runMinutesPerPiece: v })} /></td>
                  <td className="tight right muted">{cell ? `${usd(cell.hourlyCellRate, 2)}/h` : ''}</td>
                  <td className="tight"><button className="closex" onClick={() => set({ ops: s.ops.filter((_, j) => j !== i) })}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div><button className="btn small" onClick={() => set({ ops: [...s.ops, { workCell: '', setupHours: null, runMinutesPerPiece: null }] })}>+ Operation</button></div>
      </div>

      <details className="card pad" open={s.hardware.length + s.tooling.length + s.osp.length > 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Hardware, tooling and outside processing</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <ListEditor title="Hardware in one part (PEMs, rivets…)" rows={s.hardware} onChange={(hardware) => set({ hardware })} blank={{ label: '', quantity: 1, unitCost: null }}
            cols={[{ key: 'label', label: 'Item', text: true }, { key: 'quantity', label: 'Per part' }, { key: 'unitCost', label: 'Cost each ($)' }]} />
          <ListEditor title="Tooling (spread over the parts)" rows={s.tooling} onChange={(tooling) => set({ tooling })} blank={{ label: '', amount: null }}
            cols={[{ key: 'label', label: 'What', text: true }, { key: 'amount', label: 'Cost ($)' }]} />
          <ListEditor title="Outside processing (Procurement's price)" rows={s.osp} onChange={(osp) => set({ osp })} blank={{ description: '', unitPrice: null, lotCharge: null }}
            cols={[{ key: 'description', label: 'Process', text: true }, { key: 'unitPrice', label: 'Each ($)' }, { key: 'lotCharge', label: 'Lot charge ($)' }]} />
        </div>
      </details>

      <div className="card pad stack">
        <div className="spread"><b>Price</b>{!result && !error && <span className="muted small">Working it out…</span>}</div>
        {result && <MetalsBreakdown breaks={result.result.breaks} warnings={result.result.warnings} />}
        {result && result.problems.length > 0 && <div className="banner error">{result.problems.map((p) => <div key={p}>{p}</div>)}</div>}
        <ErrorBanner error={error} />
        <div className="grid2">
          <label className="field">Lead time (weeks)<NumberInput value={lead} onChange={setLead} /></label>
          <label className="field">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!result || result.problems.length > 0} onClick={async () => {
            setError(null);
            try { await post(`/lines/${line.id}/metals`, { input, save: true, leadTimeWeeks: lead, notes }); onSaved(); } catch (err) { setError(err); }
          }}>Use this price</button>
        </div>
      </div>
    </div>
  );
}

function ListEditor<T extends Record<string, any>>({ title, rows, onChange, blank, cols }: { title: string; rows: T[]; onChange: (r: T[]) => void; blank: T; cols: { key: keyof T & string; label: string; text?: boolean }[] }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small" style={{ fontWeight: 600 }}>{title}</span>
      {rows.length > 0 && (
        <table className="grid edit">
          <thead><tr>{cols.map((c) => <th key={c.key} className={c.text ? '' : 'right'}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} className={c.text ? '' : 'tight'}>
                    {c.text ? <input className="bare" value={r[c.key] ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)))} />
                      : <NumberInput className="bare" style={{ width: 100 }} value={r[c.key] ?? null} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)))} />}
                  </td>
                ))}
                <td className="tight"><button className="closex" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div><button className="btn small" onClick={() => onChange([...rows, { ...blank }])}>+ Add</button></div>
    </div>
  );
}
