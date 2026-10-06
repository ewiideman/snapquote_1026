// Molding (ADC): the "Tool Development Form" calculator. ADC fills in the part, the press and the
// mold; the server works out the price, so the price saved is the price shown.
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { Line } from '../lib/types.ts';
import { ErrorBanner, NumberInput } from '../components/ui.tsx';
import { qty, usd } from '../lib/format.ts';

interface Resin { name: string; pricePerLb: number; densityLbPerIn3: number }
interface Press { id: string; plant: string; tons: number; barrelOz: number }
type Tooling = 'domestic' | 'china' | 'portugal' | 'none';

interface Input {
  resin: string; pressId: string;
  eau: number | null; cavitation: number | null; cycleTimeSec: number | null; partVolumeIn3: number | null; wallThicknessIn: number | null; runnerLengthIn: number | null;
  footprintIn2: number | null; moldingPressure: number | null; flowLengthIn: number | null; partLengthIn: number | null; partWidthIn: number | null; partHeightIn: number | null;
  tool: { steelType: string; moldType: string; sideActionQty: number | null; gateType: string; gatesCount: number | null; runnerType: string; ejectionSide: string; complexity: number | null; domesticUsd: number | null; chinaUsd: number | null; portugalUsd: number | null };
  tooling: Tooling;
}

const BLANK: Input = {
  resin: '', pressId: '', eau: null, cavitation: 1, cycleTimeSec: null, partVolumeIn3: null, wallThicknessIn: null, runnerLengthIn: null,
  footprintIn2: null, moldingPressure: null, flowLengthIn: null, partLengthIn: null, partWidthIn: null, partHeightIn: null,
  tool: { steelType: 'P20', moldType: '2 Plate', sideActionQty: 0, gateType: 'Center Sprue', gatesCount: 1, runnerType: 'Cold Runner', ejectionSide: 'Standard', complexity: 1, domesticUsd: null, chinaUsd: null, portugalUsd: null },
  tooling: 'domestic',
};

const STEELS = ['P20', 'P20HH', 'H13', '420SS', 'Aluminum', 'Hybrid'];
const MOLD_TYPES = ['2 Plate', '3 Plate', 'MUD'];
const GATES = ['Center Sprue', 'Edge Gate', 'Sub Gate', 'Hot Tip', 'Hot Edge', 'Valve Gates'];
const RUNNERS = ['Cold Runner', 'Hot Runner', 'Hot to Cold', 'Inserted Hot Runner'];

export function MoldingCalculator({ line, onSaved }: { line: Line; onSaved: () => void }) {
  const catalog = useAsync(() => get<{ resins: Resin[]; presses: Press[] }>('/molding/catalog'), []);
  const prior = line.estimate?.basis === 'calculator' ? (line.estimate.inputs as Partial<Input> | undefined) : undefined;
  const [s, setS] = useState<Input>(() => ({ ...BLANK, ...(prior ?? {}), pressId: prior?.pressId ?? '', tool: { ...BLANK.tool, ...(prior?.tool ?? {}) } }));
  const [lead, setLead] = useState<number | null>(line.estimate?.basis === 'calculator' ? line.estimate.leadTimeWeeks : null);
  const [notes, setNotes] = useState(line.estimate?.basis === 'calculator' ? line.estimate.notes : '');
  const [out, setOut] = useState<{ result: any; problems: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const input = useMemo(() => ({ ...s, pressId: s.pressId || null }), [s]);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await post<{ result: any; problems: string[] }>(`/lines/${line.id}/molding`, { input });
        if (mine === seq.current) { setOut(r); setError(null); }
      } catch (err) { if (mine === seq.current) setError(err); }
    }, 350);
    return () => clearTimeout(t);
  }, [input, line.id]);

  const set = (c: Partial<Input>) => setS({ ...s, ...c });
  const setTool = (c: Partial<Input['tool']>) => setS({ ...s, tool: { ...s.tool, ...c } });
  const numField = (label: string, key: keyof Input, hint?: string) => (
    <label className="field">{label}<NumberInput aria-label={label} value={s[key] as number | null} onChange={(v) => set({ [key]: v } as Partial<Input>)} placeholder={hint} /></label>
  );
  const r = out?.result;
  const resins = catalog.data?.resins ?? [];
  const presses = catalog.data?.presses ?? [];

  return (
    <div className="stack">
      <div className="card pad stack">
        <b>Part</b>
        <div className="grid2">
          <label className="field">Resin
            <select aria-label="Resin" value={s.resin} onChange={(e) => set({ resin: e.target.value })}>
              <option value="">Choose a resin…</option>
              {resins.map((x) => <option key={x.name} value={x.name}>{x.name}{x.pricePerLb > 0 ? ` — ${usd(x.pricePerLb, 2)}/lb` : ' — no price'}</option>)}
            </select>
          </label>
          {numField('Annual volume (EAU)', 'eau', 'pieces a year')}
        </div>
        <div className="grid3">
          {numField('Cavities', 'cavitation')}
          {numField('Cycle time (s)', 'cycleTimeSec')}
          {numField('Part volume (in³)', 'partVolumeIn3')}
          {numField('Wall (in)', 'wallThicknessIn')}
          {numField('Runner length (in)', 'runnerLengthIn')}
          {numField('Projected area (in²)', 'footprintIn2')}
          {numField('Pressure (tons/in²)', 'moldingPressure')}
          {numField('Flow length (in)', 'flowLengthIn')}
          {numField('Length (in)', 'partLengthIn')}
          {numField('Width (in)', 'partWidthIn')}
          {numField('Height (in)', 'partHeightIn')}
        </div>
      </div>

      <div className="card pad stack">
        <b>Press</b>
        <label className="field">Press
          <select aria-label="Press" value={s.pressId} onChange={(e) => set({ pressId: e.target.value })}>
            <option value="">The smallest that fits{r?.press && !s.pressId ? ` (${r.press.id})` : ''}</option>
            {presses.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.plant}, {qty(p.tons)} t</option>)}
          </select>
        </label>
      </div>

      <details className="card pad" open>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Mold</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="grid3">
            <label className="field">Steel<select value={s.tool.steelType} onChange={(e) => setTool({ steelType: e.target.value })}>{STEELS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Mold type<select value={s.tool.moldType} onChange={(e) => setTool({ moldType: e.target.value })}>{MOLD_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Gate<select value={s.tool.gateType} onChange={(e) => setTool({ gateType: e.target.value })}>{GATES.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Runner<select value={s.tool.runnerType} onChange={(e) => setTool({ runnerType: e.target.value })}>{RUNNERS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Gates<NumberInput value={s.tool.gatesCount} onChange={(v) => setTool({ gatesCount: v })} /></label>
            <label className="field">Side actions<NumberInput value={s.tool.sideActionQty} onChange={(v) => setTool({ sideActionQty: v })} /></label>
            <label className="field">Complexity (1–5)<NumberInput value={s.tool.complexity} onChange={(v) => setTool({ complexity: v })} /></label>
            <label className="field">Ejection<select value={s.tool.ejectionSide} onChange={(e) => setTool({ ejectionSide: e.target.value })}><option>Standard</option><option>Reverse</option></select></label>
          </div>
          <table className="grid">
            <thead><tr><th>Mold estimate</th><th className="right">Worked out</th><th className="right">Your figure (optional)</th><th>On the quote</th></tr></thead>
            <tbody>
              {(['domestic', 'china', 'portugal'] as const).map((k) => {
                const key = `${k}Usd` as 'domesticUsd' | 'chinaUsd' | 'portugalUsd';
                return (
                  <tr key={k}>
                    <td>{k === 'domestic' ? 'Domestic' : k === 'china' ? 'China' : 'Portugal'}</td>
                    <td className="right">{r ? usd(r.tool[k], 0) : ''}</td>
                    <td className="right tight"><NumberInput className="bare" style={{ width: 110 }} value={s.tool[key]} onChange={(v) => setTool({ [key]: v })} placeholder="$" /></td>
                    <td><input type="radio" name="tooling" aria-label={`Quote the ${k} mold`} checked={s.tooling === k} onChange={() => set({ tooling: k })} /></td>
                  </tr>
                );
              })}
              <tr><td colSpan={3} className="muted">No mold on this quote</td><td><input type="radio" name="tooling" aria-label="No mold on this quote" checked={s.tooling === 'none'} onChange={() => set({ tooling: 'none' })} /></td></tr>
            </tbody>
          </table>
        </div>
      </details>

      <div className="card pad stack">
        <div className="spread"><b>Price</b>{!out && !error && <span className="muted small">Working it out…</span>}</div>
        {out && out.problems.length > 0 && <div className="banner warn">{out.problems.map((p) => <div key={p}>{p}</div>)}</div>}
        {r && (
          <>
            <table className="grid">
              <tbody>
                <tr><td className="muted">Material ({r.shotWeightOz} oz shot, runner included)</td><td className="right">{usd(r.materialPerPart, 4)}</td></tr>
                <tr><td className="muted">Press time ({r.press.id}, {qty(Math.round(r.process.partsPerHour))} parts an hour)</td><td className="right">{usd(r.moldingPerPart, 4)}</td></tr>
                <tr><td className="muted">Setup (4 a year over {qty(s.eau ?? 0)} pieces)</td><td className="right">{usd(r.setupPerPart, 4)}</td></tr>
                <tr><td><b>Price each, at every quantity</b></td><td className="right"><b>{usd(r.perPart, 4)}</b></td></tr>
                {r.tool.oneTimeUsd > 0 && <tr><td>{r.tool.oneTimeLabel}, one time</td><td className="right">{usd(r.tool.oneTimeUsd, 2)}</td></tr>}
              </tbody>
            </table>
            <div className="small muted">
              Needs about {qty(Math.ceil(r.process.minTonnage))} t · shot {r.process.shotToBarrelPct}% of barrel · {r.process.pressDaysPerYear} press days a year ({r.process.pressUtilizationPct}%) · {qty(r.process.resinLbPerYear)} lb resin a year · mold about {qty(Math.round(r.tool.weightLb))} lb
            </div>
            {r.warnings.length > 0 && <div className="banner warn">{r.warnings.map((w: string) => <div key={w}>{w}</div>)}</div>}
          </>
        )}
        <ErrorBanner error={error} />
        <div className="grid2">
          <label className="field">Lead time (weeks)<NumberInput value={lead} onChange={setLead} /></label>
          <label className="field">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!r} onClick={async () => {
            setError(null);
            try { await post(`/lines/${line.id}/molding`, { input, save: true, leadTimeWeeks: lead, notes }); onSaved(); } catch (err) { setError(err); }
          }}>Use this price</button>
        </div>
      </div>
    </div>
  );
}
