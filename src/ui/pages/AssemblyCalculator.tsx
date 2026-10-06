// Assembly: seconds per step, by section, times the labor rate -- the old Assembly screen's price.
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { Line } from '../lib/types.ts';
import { ErrorBanner, NumberInput } from '../components/ui.tsx';
import { qty, usd } from '../lib/format.ts';

interface Step { label: string; assemblySec: number | null; testSec: number | null; qaSec: number | null }
interface Equip { label: string; cost: number | null; nre: number | null }
interface Section { name: string; partsPerAssembly: number | null; steps: Step[]; equipment: Equip[] }
interface Input { laborRatePerHour: number | null; sections: Section[] }

const blankStep = (): Step => ({ label: '', assemblySec: null, testSec: null, qaSec: null });
const BLANK: Input = { laborRatePerHour: null, sections: [{ name: 'Top level', partsPerAssembly: 1, steps: [blankStep()], equipment: [] }] };

export function AssemblyCalculator({ line, onSaved }: { line: Line; onSaved: () => void }) {
  const settings = useAsync(() => get<{ laborRatePerHour: number }>('/assembly/settings'), []);
  const prior = line.estimate?.basis === 'calculator' ? (line.estimate.inputs as Input | undefined) : undefined;
  const [s, setS] = useState<Input>(() => (prior?.sections?.length ? prior : BLANK));
  const [lead, setLead] = useState<number | null>(line.estimate?.basis === 'calculator' ? line.estimate.leadTimeWeeks : null);
  const [notes, setNotes] = useState(line.estimate?.basis === 'calculator' ? line.estimate.notes : '');
  const [out, setOut] = useState<{ result: any; problems: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const input = useMemo(() => s, [s]);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await post<{ result: any; problems: string[] }>(`/lines/${line.id}/assembly`, { input });
        if (mine === seq.current) { setOut(r); setError(null); }
      } catch (err) { if (mine === seq.current) setError(err); }
    }, 350);
    return () => clearTimeout(t);
  }, [input, line.id]);

  const setSection = (i: number, c: Partial<Section>) => setS({ ...s, sections: s.sections.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const r = out?.result;
  return (
    <div className="stack">
      <div className="card pad stack">
        <div className="grid3">
          <label className="field">Labor rate ($/hour)<NumberInput aria-label="Labor rate" value={s.laborRatePerHour} onChange={(v) => setS({ ...s, laborRatePerHour: v })} placeholder={settings.data ? `${settings.data.laborRatePerHour} standard` : ''} /></label>
        </div>
      </div>
      {s.sections.map((sec, i) => (
        <div className="card pad stack" key={i}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label className="field grow">Section<input value={sec.name} onChange={(e) => setSection(i, { name: e.target.value })} /></label>
            <label className="field">Per assembly<NumberInput aria-label={`Per assembly, ${sec.name}`} style={{ width: 90 }} value={sec.partsPerAssembly} onChange={(v) => setSection(i, { partsPerAssembly: v })} /></label>
            {s.sections.length > 1 && <button className="closex" title="Remove this section" onClick={() => setS({ ...s, sections: s.sections.filter((_, j) => j !== i) })}>×</button>}
          </div>
          <table className="grid edit">
            <thead><tr><th>Step</th><th className="right">Assembly (s)</th><th className="right">Test (s)</th><th className="right">QA (s)</th><th /></tr></thead>
            <tbody>
              {sec.steps.map((st, k) => {
                const upd = (c: Partial<Step>) => setSection(i, { steps: sec.steps.map((x, j) => (j === k ? { ...x, ...c } : x)) });
                return (
                  <tr key={k}>
                    <td><input className="bare" value={st.label} placeholder="What is done" onChange={(e) => upd({ label: e.target.value })} /></td>
                    <td className="tight"><NumberInput aria-label={`Assembly seconds, step ${k + 1}`} className="bare" style={{ width: 80 }} value={st.assemblySec} onChange={(v) => upd({ assemblySec: v })} /></td>
                    <td className="tight"><NumberInput className="bare" style={{ width: 80 }} value={st.testSec} onChange={(v) => upd({ testSec: v })} /></td>
                    <td className="tight"><NumberInput className="bare" style={{ width: 80 }} value={st.qaSec} onChange={(v) => upd({ qaSec: v })} /></td>
                    <td className="tight"><button className="closex" onClick={() => setSection(i, { steps: sec.steps.filter((_, j) => j !== k) })}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div><button className="btn small" onClick={() => setSection(i, { steps: [...sec.steps, blankStep()] })}>+ Step</button></div>
          <details open={sec.equipment.length > 0}>
            <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Equipment and tooling (one time)</summary>
            <table className="grid edit" style={{ marginTop: 8 }}>
              <thead><tr><th>Item</th><th className="right">Mack cost ($)</th><th className="right">NRE ($)</th><th /></tr></thead>
              <tbody>
                {sec.equipment.map((e, k) => {
                  const upd = (c: Partial<Equip>) => setSection(i, { equipment: sec.equipment.map((x, j) => (j === k ? { ...x, ...c } : x)) });
                  return (
                    <tr key={k}>
                      <td><input className="bare" value={e.label} onChange={(ev) => upd({ label: ev.target.value })} /></td>
                      <td className="tight"><NumberInput className="bare" style={{ width: 100 }} value={e.cost} onChange={(v) => upd({ cost: v })} /></td>
                      <td className="tight"><NumberInput className="bare" style={{ width: 100 }} value={e.nre} onChange={(v) => upd({ nre: v })} /></td>
                      <td className="tight"><button className="closex" onClick={() => setSection(i, { equipment: sec.equipment.filter((_, j) => j !== k) })}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 6 }}><button className="btn small" onClick={() => setSection(i, { equipment: [...sec.equipment, { label: '', cost: null, nre: null }] })}>+ Equipment</button></div>
          </details>
        </div>
      ))}
      <div><button className="btn small" onClick={() => setS({ ...s, sections: [...s.sections, { name: `Sub-assembly ${s.sections.length}`, partsPerAssembly: 1, steps: [blankStep()], equipment: [] }] })}>+ Section</button></div>

      <div className="card pad stack">
        <div className="spread"><b>Price</b>{!out && !error && <span className="muted small">Working it out…</span>}</div>
        {out && out.problems.length > 0 && <div className="banner warn">{out.problems.map((p) => <div key={p}>{p}</div>)}</div>}
        {r && <AssemblyBreakdown result={r} />}
        <ErrorBanner error={error} />
        <div className="grid2">
          <label className="field">Lead time (weeks)<NumberInput value={lead} onChange={setLead} /></label>
          <label className="field">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!r} onClick={async () => {
            setError(null);
            try { await post(`/lines/${line.id}/assembly`, { input, save: true, leadTimeWeeks: lead, notes }); onSaved(); } catch (err) { setError(err); }
          }}>Use this price</button>
        </div>
      </div>
    </div>
  );
}

export function AssemblyBreakdown({ result }: { result: any }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <table className="grid">
        <tbody>
          <tr><td className="muted">Assembly, test and QA</td><td className="right">{qty(result.assemblySec)} + {qty(result.testSec)} + {qty(result.qaSec)} s = {result.hoursPerAssembly.toFixed(2)} h</td></tr>
          <tr><td className="muted">Labor rate</td><td className="right">{usd(result.laborRatePerHour, 2)}/h</td></tr>
          <tr><td><b>Price each, at every quantity</b></td><td className="right"><b>{usd(result.perUnit, 2)}</b></td></tr>
          {result.oneTimeUsd > 0 && <tr><td>Equipment and tooling, one time</td><td className="right">{usd(result.oneTimeUsd, 2)}</td></tr>}
        </tbody>
      </table>
      {result.warnings.length > 0 && <div className="banner warn">{result.warnings.map((w: string) => <div key={w}>{w}</div>)}</div>}
    </div>
  );
}
