// Chris Glaski's table: which XA facilities each Metals work cell is, so a quote's hours land on the
// machines the Production Scheduler schedules. Nothing here is matched by name.
import { useMemo, useState } from 'react';
import { get, put } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import { ErrorBanner, useApp } from '../components/ui.tsx';
import { ago, qty } from '../lib/format.ts';
import { caughtUpWords, loadTone, metalsFacilities, pct, workCellCapacity, type CapacityRead, type Mapping } from '../lib/capacity.ts';

interface Data { capacity: CapacityRead; workCells: { name: string; mapping: Mapping | null }[] }

function Picker({ cell, current, read, onSave, onClose }: { cell: string; current: string[] | null; read: CapacityRead; onSave: (f: string[] | null) => void; onClose: () => void }) {
  const all = metalsFacilities(read);
  const [chosen, setChosen] = useState<string[]>(current ?? []);
  const [typed, setTyped] = useState('');
  const [find, setFind] = useState('');
  const shown = all.filter((f) => !find || `${f.code} ${f.name}`.toLowerCase().includes(find.toLowerCase()));
  const toggle = (c: string) => setChosen(chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" style={{ width: 'min(620px, 94vw)' }}>
        <header><h2>{cell}</h2><p className="muted small">Choose the XA facilities this work cell is. Several when the work cell is more than one machine.</p></header>
        <div className="body">
          {all.length > 0 ? (
            <>
              <input placeholder="Find a facility" value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
              <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
                <table className="grid">
                  <tbody>
                    {shown.map((f) => (
                      <tr key={f.code} className="click" onClick={() => toggle(f.code)}>
                        <td className="tight"><input type="checkbox" checked={chosen.includes(f.code)} onChange={() => toggle(f.code)} aria-label={f.code} /></td>
                        <td className="tight mono">{f.code}</td>
                        <td>{f.name}</td>
                        <td className="tight right muted small">{qty(f.hoursPerWeek)} h/wk</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="banner info">The scheduler's facility list is not here yet, so type the XA facility codes (for example 7/V85).</div>
          )}
          <div className="row">
            <input placeholder="Or type a facility code" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) { toggle(typed.trim()); setTyped(''); } }} />
            <button className="btn small" disabled={!typed.trim()} onClick={() => { toggle(typed.trim()); setTyped(''); }}>Add</button>
          </div>
          {chosen.length > 0 && <div className="row wrap">{chosen.map((c) => <span key={c} className="chip">{c} <button className="link" onClick={() => toggle(c)} aria-label={`Remove ${c}`}>×</button></span>)}</div>}
        </div>
        <footer>
          <button className="btn ghost" onClick={() => onSave([])} title="The scheduler does not schedule this work cell">Not a scheduled facility</button>
          {current !== null && <button className="btn ghost" onClick={() => onSave(null)}>Clear</button>}
          <span className="grow" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={chosen.length === 0} onClick={() => onSave(chosen)}>Save</button>
        </footer>
      </div>
    </>
  );
}

export function WorkCells() {
  const app = useApp();
  const { data, error, reload } = useAsync(() => get<Data>('/metals/facilities'), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const names = useMemo(() => new Map(metalsFacilities(data?.capacity).map((f) => [f.code, f.name])), [data]);
  const read = data?.capacity;
  const file = read && read.connected ? read.file : null;
  const tied = (data?.workCells ?? []).filter((w) => w.mapping).length;
  return (
    <div className="page narrow stack" style={{ gap: 16 }}>
      <div className="hello">
        <div>
          <h1>Metals work cells and XA facilities</h1>
          <p>Tie each work cell on the rate sheet to the XA facilities the Production Scheduler schedules. Quotes priced with the calculator then show the plant's load, and the scheduler sees their hours.</p>
        </div>
      </div>
      {read && !read.connected && <div className="banner warn">This server is not linked to the Production Scheduler (MACK_EXCHANGE_DIR is not set). The table can still be filled in.</div>}
      {read && read.connected && !file && <div className="banner warn">{read.problem}</div>}
      {file && <div className="banner info">Facilities and load from the scheduler's {file.departments.find((d) => d.key === 'metals')?.scheduleName ?? 'schedule'}, written {ago(file.writtenAt)}. {file.basis}</div>}
      <ErrorBanner error={error ?? saveError} />
      <div className="section">
        <header><h2>Work cells</h2><span className="muted small">{data ? `${tied} of ${data.workCells.length} tied` : ''}</span></header>
        <table className="grid">
          <thead><tr><th>Work cell</th><th>XA facilities</th><th className="right">Hours a week</th><th className="right">Load</th><th>Late work</th><th>Set by</th><th /></tr></thead>
          <tbody>
            {(data?.workCells ?? []).map((w) => {
              const codes = w.mapping?.facilities ?? null;
              const cap = codes && codes.length ? workCellCapacity(read, codes) : null;
              return (
                <tr key={w.name}>
                  <td><b>{w.name}</b></td>
                  <td>{codes === null ? <span className="chip soon">not tied yet</span> : codes.length === 0 ? <span className="muted">not a scheduled facility</span>
                    : codes.map((c) => <span key={c} className="mono" title={names.get(c) ?? 'not in the scheduler\'s file'} style={{ marginRight: 8, color: names.size && !names.has(c) ? 'var(--late)' : undefined }}>{c}</span>)}</td>
                  <td className="right">{cap ? qty(cap.hoursPerWeek) : ''}</td>
                  <td className="right">{cap ? <span className={`chip ${loadTone(cap.load) === 'ok' ? '' : loadTone(cap.load)}`}>{pct(cap.load)}</span> : ''}</td>
                  <td className="small">{cap && file ? caughtUpWords(cap, file.horizonWeeks) : ''}</td>
                  <td className="muted small">{w.mapping ? `${w.mapping.setByName}, ${ago(w.mapping.setAt)}` : ''}</td>
                  <td className="tight"><button className="btn small" onClick={() => setEditing(w.name)}>{codes === null ? 'Tie' : 'Change'}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && read && (
        <Picker cell={editing} read={read} current={data?.workCells.find((w) => w.name === editing)?.mapping?.facilities ?? null} onClose={() => setEditing(null)} onSave={async (facilities) => {
          setSaveError(null);
          try {
            await put('/metals/facilities', { workCell: editing, facilities });
            app.toast(facilities === null ? `${editing} cleared.` : facilities.length ? `${editing} is ${facilities.join(', ')}.` : `${editing} is not a scheduled facility.`);
            setEditing(null);
            reload();
          } catch (err) { setSaveError(err); }
        }} />
      )}
    </div>
  );
}
