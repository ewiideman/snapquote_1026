// Machining: the "SNAPQUOTE EXCEL TEMPLATE" calculator. The estimator fills in the machining, the
// material and what else the part needs; the server works out the price at each quantity.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, post } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { Line } from '../lib/types.ts';
import { ErrorBanner, NumberInput } from '../components/ui.tsx';
import { qty, usd } from '../lib/format.ts';

interface Machine { name: string; ratePerHour: number }
interface Stock { partNumber: string; description: string; barLengthFeet: number; costPerBar: number }
type Lot = { cost: number | null; amortized: boolean; leadWeeks: number | null };

const BLANK = {
  primaryMachine: '', primaryCycleSec: null as number | null, primarySetupHours: null as number | null, primaryDutyCycle: null as number | null, primaryLeadWeeks: null as number | null,
  secondaryMachine: '', secondaryCycleSec: null as number | null, secondarySetupHours: null as number | null, secondaryDutyCycle: null as number | null, secondaryLeadWeeks: null as number | null,
  operatingShifts: 1 as number | null,
  deburr: false, partsPerDeburrCycle: null as number | null, sandblast: false, partsPerSandblastCycle: null as number | null,
  cleaning: false, partsPerCleaningCycle: null as number | null, partMarking: false,
  packaging: 'NONE' as 'BULK' | 'SEPARATE' | 'NONE', partsPerBox: null as number | null, costPerBox: null as number | null,
  perishableToolingPct: null as number | null, programmingHours: null as number | null, programmingAmortized: false, programmingLeadWeeks: null as number | null,
  material: { mode: 'STOCKED' as 'STOCKED' | 'CUSTOM', partNumber: '', unitPrice: null as number | null, stockLengthIn: null as number | null, rawLengthIn: null as number | null, remnantIn: null as number | null },
  workholding: { cost: null, amortized: false, leadWeeks: null } as Lot, tooling: { cost: null, amortized: false, leadWeeks: null } as Lot, gaging: { cost: null, amortized: false, leadWeeks: null } as Lot,
  inspectionLevel: 'NONE', inspectionDifficulty: 'B',
  fai: { required: false, parts: null as number | null, leadWeeks: null as number | null },
  capStudy: { required: false, featuresXParts: null as number | null, leadWeeks: null as number | null },
  gageRr: { required: false, studies: null as number | null, leadWeeks: null as number | null },
  coc: false,
  assemblyOps: [] as { label: string; costEach: number | null; ship: boolean; leadWeeks: number | null }[],
  outsideOps: [] as { label: string; costEach: number | null; lotCharge: number | null; leadWeeks: number | null }[],
};
type Input = typeof BLANK;

function Num({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: string }) {
  return <label className="field">{label}<NumberInput aria-label={label} value={value} onChange={onChange} placeholder={hint} /></label>;
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="row small" style={{ gap: 6, alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
}
function Group({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return <details className="card pad" open={open}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>{title}</summary><div className="stack" style={{ marginTop: 12 }}>{children}</div></details>;
}

export function MachiningCalculator({ line, onSaved }: { line: Line; onSaved: () => void }) {
  const catalog = useAsync(() => get<{ machines: Machine[]; stock: Stock[] }>('/machining/catalog'), []);
  const prior = line.estimate?.basis === 'calculator' ? (line.estimate.inputs as Partial<Input> | undefined) : undefined;
  const [s, setS] = useState<Input>(() => ({ ...BLANK, ...(prior ?? {}), secondaryMachine: prior?.secondaryMachine ?? '', material: { ...BLANK.material, ...(prior?.material ?? {}) } }));
  const [lead, setLead] = useState<number | null>(line.estimate?.basis === 'calculator' ? line.estimate.leadTimeWeeks : null);
  const [notes, setNotes] = useState(line.estimate?.basis === 'calculator' ? line.estimate.notes : '');
  const [stockSearch, setStockSearch] = useState('');
  const [out, setOut] = useState<{ result: any; problems: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const input = useMemo(() => ({ ...s, secondaryMachine: s.secondaryMachine || null }), [s]);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await post<{ result: any; problems: string[] }>(`/lines/${line.id}/machining`, { input });
        if (mine === seq.current) { setOut(r); setError(null); }
      } catch (err) { if (mine === seq.current) setError(err); }
    }, 350);
    return () => clearTimeout(t);
  }, [input, line.id]);

  const set = (c: Partial<Input>) => setS({ ...s, ...c });
  const setMat = (c: Partial<Input['material']>) => set({ material: { ...s.material, ...c } });
  const machines = catalog.data?.machines ?? [];
  const stock = catalog.data?.stock ?? [];
  const bar = stock.find((x) => x.partNumber === s.material.partNumber);
  const shownStock = stock.filter((x) => !stockSearch || `${x.partNumber} ${x.description}`.toLowerCase().includes(stockSearch.toLowerCase())).slice(0, 200);
  const r = out?.result;
  const lotRow = (k: 'workholding' | 'tooling' | 'gaging', label: string) => (
    <div className="grid3" key={k}>
      <Num label={`${label} ($)`} value={s[k].cost} onChange={(v) => set({ [k]: { ...s[k], cost: v } } as Partial<Input>)} />
      <Num label={`${label} lead (weeks)`} value={s[k].leadWeeks} onChange={(v) => set({ [k]: { ...s[k], leadWeeks: v } } as Partial<Input>)} />
      <Check label="Spread over the parts" value={s[k].amortized} onChange={(v) => set({ [k]: { ...s[k], amortized: v } } as Partial<Input>)} />
    </div>
  );
  const machineSelect = (label: string, value: string, onChange: (v: string) => void, optional: boolean) => (
    <label className="field">{label}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? 'None' : 'Choose a machine…'}</option>
        {machines.map((m) => <option key={m.name} value={m.name}>{m.name} — {usd(m.ratePerHour, 0)}/h</option>)}
      </select>
    </label>
  );

  return (
    <div className="stack">
      <div className="card pad stack">
        <b>Machining</b>
        <div className="grid3">
          {machineSelect('Machine', s.primaryMachine, (v) => set({ primaryMachine: v }), false)}
          <Num label="Cycle time (s)" value={s.primaryCycleSec} onChange={(v) => set({ primaryCycleSec: v })} />
          <Num label="Setup (hours)" value={s.primarySetupHours} onChange={(v) => set({ primarySetupHours: v })} />
          <Num label="Operator time (0–1)" value={s.primaryDutyCycle} onChange={(v) => set({ primaryDutyCycle: v })} hint="1 = attended" />
          <Num label="Machine lead (weeks)" value={s.primaryLeadWeeks} onChange={(v) => set({ primaryLeadWeeks: v })} />
          <Num label="Shifts" value={s.operatingShifts} onChange={(v) => set({ operatingShifts: v })} />
        </div>
        <div className="grid3">
          {machineSelect('Second machine', s.secondaryMachine, (v) => set({ secondaryMachine: v }), true)}
          {s.secondaryMachine && <>
            <Num label="Second cycle (s)" value={s.secondaryCycleSec} onChange={(v) => set({ secondaryCycleSec: v })} />
            <Num label="Second setup (hours)" value={s.secondarySetupHours} onChange={(v) => set({ secondarySetupHours: v })} />
            <Num label="Second operator time (0–1)" value={s.secondaryDutyCycle} onChange={(v) => set({ secondaryDutyCycle: v })} />
            <Num label="Second lead (weeks)" value={s.secondaryLeadWeeks} onChange={(v) => set({ secondaryLeadWeeks: v })} />
          </>}
        </div>
        <div className="grid3">
          <Num label="Programming (hours)" value={s.programmingHours} onChange={(v) => set({ programmingHours: v })} />
          <Num label="Programming lead (weeks)" value={s.programmingLeadWeeks} onChange={(v) => set({ programmingLeadWeeks: v })} />
          <Check label="Spread programming over the parts" value={s.programmingAmortized} onChange={(v) => set({ programmingAmortized: v })} />
          <Num label="Perishable tooling (share of machining)" value={s.perishableToolingPct} onChange={(v) => set({ perishableToolingPct: v })} hint="0.06 = 6%" />
        </div>
      </div>

      <div className="card pad stack">
        <div className="spread"><b>Material</b>
          <div className="seg"><button className={s.material.mode === 'STOCKED' ? 'on' : ''} onClick={() => setMat({ mode: 'STOCKED' })}>Bar stock</button><button className={s.material.mode === 'CUSTOM' ? 'on' : ''} onClick={() => setMat({ mode: 'CUSTOM' })}>Custom price</button></div></div>
        {s.material.mode === 'STOCKED' ? (
          <>
            <div className="grid2">
              <label className="field">Find a bar<input placeholder="Item number, alloy or size" value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} /></label>
              <label className="field">Bar
                <select aria-label="Bar" value={s.material.partNumber} onChange={(e) => setMat({ partNumber: e.target.value })}>
                  <option value="">Choose a bar…</option>
                  {bar && !shownStock.includes(bar) && <option value={bar.partNumber}>{bar.partNumber} — {bar.description}</option>}
                  {shownStock.map((x) => <option key={x.partNumber} value={x.partNumber}>{x.partNumber} — {x.description}{x.costPerBar > 0 ? ` — ${usd(x.costPerBar, 2)}/bar` : ' — no cost'}</option>)}
                </select>
              </label>
            </div>
            {bar && <span className="muted small">{qty(bar.barLengthFeet)} ft bar, {usd(bar.costPerBar, 2)}</span>}
          </>
        ) : (
          <div className="grid3">
            <Num label="Material each ($)" value={s.material.unitPrice} onChange={(v) => setMat({ unitPrice: v })} />
            <Num label="Stock length (in)" value={s.material.stockLengthIn} onChange={(v) => setMat({ stockLengthIn: v })} />
          </div>
        )}
        <div className="grid3">
          <Num label="Stock per part (in)" value={s.material.rawLengthIn} onChange={(v) => setMat({ rawLengthIn: v })} />
          <Num label="Remnant per bar (in)" value={s.material.remnantIn} onChange={(v) => setMat({ remnantIn: v })} />
        </div>
      </div>

      <Group title="Finishing and packaging" open={s.deburr || s.sandblast || s.cleaning || s.partMarking || s.packaging !== 'NONE'}>
        <div className="grid3">
          <Check label="Vibratory deburr" value={s.deburr} onChange={(v) => set({ deburr: v })} />
          {s.deburr && <Num label="Parts per deburr batch" value={s.partsPerDeburrCycle} onChange={(v) => set({ partsPerDeburrCycle: v })} />}
        </div>
        <div className="grid3">
          <Check label="Sand blast" value={s.sandblast} onChange={(v) => set({ sandblast: v })} />
          {s.sandblast && <Num label="Parts per blast batch" value={s.partsPerSandblastCycle} onChange={(v) => set({ partsPerSandblastCycle: v })} />}
        </div>
        <div className="grid3">
          <Check label="Cleaning" value={s.cleaning} onChange={(v) => set({ cleaning: v })} />
          {s.cleaning && <Num label="Parts per cleaning batch" value={s.partsPerCleaningCycle} onChange={(v) => set({ partsPerCleaningCycle: v })} />}
          <Check label="Part marking" value={s.partMarking} onChange={(v) => set({ partMarking: v })} />
        </div>
        <div className="grid3">
          <label className="field">Packaging<select value={s.packaging} onChange={(e) => set({ packaging: e.target.value as Input['packaging'] })}><option value="NONE">None</option><option value="BULK">Bulk</option><option value="SEPARATE">Separately</option></select></label>
          {s.packaging !== 'NONE' && <><Num label="Parts per box" value={s.partsPerBox} onChange={(v) => set({ partsPerBox: v })} /><Num label="Box cost ($)" value={s.costPerBox} onChange={(v) => set({ costPerBox: v })} /></>}
        </div>
      </Group>

      <Group title="Fixtures, tooling and gages" open={[s.workholding, s.tooling, s.gaging].some((x) => x.cost)}>
        {lotRow('workholding', 'Workholding')}
        {lotRow('tooling', 'Initial tooling')}
        {lotRow('gaging', 'Gaging')}
        <span className="muted small">Not spread over the parts, they are the one-time charge on the quote.</span>
      </Group>

      <Group title="Inspection and qualification" open={s.inspectionLevel !== 'NONE' || s.fai.required || s.capStudy.required || s.gageRr.required || s.coc}>
        <div className="grid3">
          <label className="field">Inspection<select value={s.inspectionLevel} onChange={(e) => set({ inspectionLevel: e.target.value })}>{['NONE', 'AQL 1.0', 'AQL 1.5', 'AQL 2.5', 'AQL 4.0', '100%'].map((x) => <option key={x} value={x}>{x === 'NONE' ? 'None' : x}</option>)}</select></label>
          <label className="field">Difficulty<select value={s.inspectionDifficulty} onChange={(e) => set({ inspectionDifficulty: e.target.value })}><option value="A">A — simple</option><option value="B">B — standard</option><option value="C">C — complex</option><option value="D">D — extreme</option></select></label>
          <Check label="Certificate of conformance" value={s.coc} onChange={(v) => set({ coc: v })} />
        </div>
        <div className="grid3">
          <Check label="First article" value={s.fai.required} onChange={(v) => set({ fai: { ...s.fai, required: v } })} />
          {s.fai.required && <><Num label="First article parts" value={s.fai.parts} onChange={(v) => set({ fai: { ...s.fai, parts: v } })} /><Num label="First article lead (weeks)" value={s.fai.leadWeeks} onChange={(v) => set({ fai: { ...s.fai, leadWeeks: v } })} /></>}
        </div>
        <div className="grid3">
          <Check label="Capability study" value={s.capStudy.required} onChange={(v) => set({ capStudy: { ...s.capStudy, required: v } })} />
          {s.capStudy.required && <><Num label="Features × parts" value={s.capStudy.featuresXParts} onChange={(v) => set({ capStudy: { ...s.capStudy, featuresXParts: v } })} /><Num label="Study lead (weeks)" value={s.capStudy.leadWeeks} onChange={(v) => set({ capStudy: { ...s.capStudy, leadWeeks: v } })} /></>}
        </div>
        <div className="grid3">
          <Check label="Gage R&R" value={s.gageRr.required} onChange={(v) => set({ gageRr: { ...s.gageRr, required: v } })} />
          {s.gageRr.required && <><Num label="Studies" value={s.gageRr.studies} onChange={(v) => set({ gageRr: { ...s.gageRr, studies: v } })} /><Num label="Gage R&R lead (weeks)" value={s.gageRr.leadWeeks} onChange={(v) => set({ gageRr: { ...s.gageRr, leadWeeks: v } })} /></>}
        </div>
      </Group>

      <Group title="Outside processing and assembly" open={s.outsideOps.length + s.assemblyOps.length > 0}>
        <OpsEditor title="Outside processing (plating, heat treat…)" rows={s.outsideOps} onChange={(outsideOps) => set({ outsideOps })} blank={{ label: '', costEach: null, lotCharge: null, leadWeeks: null }}
          cols={[['label', 'Process'], ['costEach', 'Each ($)'], ['lotCharge', 'Lot charge ($)'], ['leadWeeks', 'Lead (weeks)']]} />
        <OpsEditor title="Assembly operations" rows={s.assemblyOps} onChange={(assemblyOps) => set({ assemblyOps })} blank={{ label: '', costEach: null, ship: false, leadWeeks: null }}
          cols={[['label', 'Operation'], ['costEach', 'Each ($)'], ['leadWeeks', 'Lead (weeks)'], ['ship', 'Shipped']]} />
      </Group>

      <div className="card pad stack">
        <div className="spread"><b>Price</b>{!out && !error && <span className="muted small">Working it out…</span>}</div>
        {out && out.problems.length > 0 && <div className="banner warn">{out.problems.map((p) => <div key={p}>{p}</div>)}</div>}
        {r && <MachiningBreakdown result={r} />}
        <ErrorBanner error={error} />
        <div className="grid2">
          <label className="field">Lead time (weeks)<NumberInput value={lead} onChange={setLead} placeholder={r ? `${Math.ceil(r.leadWeeks)} worked out` : ''} /></label>
          <label className="field">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!r} onClick={async () => {
            setError(null);
            try { await post(`/lines/${line.id}/machining`, { input, save: true, leadTimeWeeks: lead, notes }); onSaved(); } catch (err) { setError(err); }
          }}>Use this price</button>
        </div>
      </div>
    </div>
  );
}

export function MachiningBreakdown({ result }: { result: any }) {
  const rows: [string, string[]][] = [
    ['Machining', ['primary_machining_cost', 'secondary_machining_cost']],
    ['Setup', ['setup_cost']],
    ['Material', ['raw_material_cost', 'raw_material_markup_cost']],
    ['Finishing and packaging', ['vibratory_deburr_cost', 'sand_blasting_cost', 'cleaning_cost', 'part_marking_cost', 'packaging_cost']],
    ['Tooling and programming', ['perishable_tooling_cost', 'programming_cost', 'workholding_cost', 'initial_tooling_cost', 'gaging_cost']],
    ['Inspection', ['aql_inspection_cost', 'certificate_cost_total']],
    ['Outside processing and assembly', ['outside_operation_cost', 'assembly_cost']],
  ];
  const each = (b: any, keys: string[]) => keys.reduce((t, k) => t + (b[k] ?? 0), 0) / b.quantity;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="grid">
          <thead><tr><th>Per part</th>{result.breaks.map((b: any) => <th key={b.quantity} className="right">{qty(b.quantity)}</th>)}</tr></thead>
          <tbody>
            {rows.filter(([, keys]) => result.breaks.some((b: any) => keys.some((k) => (b[k] ?? 0) !== 0))).map(([label, keys]) => (
              <tr key={label}><td className="muted">{label}</td>{result.breaks.map((b: any) => <td key={b.quantity} className="right">{usd(each(b, keys), 4)}</td>)}</tr>
            ))}
            <tr><td><b>Price each</b></td>{result.breaks.map((b: any) => <td key={b.quantity} className="right"><b>{usd(b.selling_price_each, 4)}</b></td>)}</tr>
          </tbody>
        </table>
      </div>
      <div className="small muted">{result.breaks[0] && result.breaks[0].parts_per_bar > 0 ? `${result.breaks[0].parts_per_bar} parts a bar · ` : ''}one-time {usd(result.nreCost, 2)} · lead time about {Math.ceil(result.leadWeeks)} weeks</div>
      {result.warnings.length > 0 && <div className="banner warn">{result.warnings.map((w: string) => <div key={w}>{w}</div>)}</div>}
    </div>
  );
}

function OpsEditor<T extends Record<string, any>>({ title, rows, onChange, blank, cols }: { title: string; rows: T[]; onChange: (r: T[]) => void; blank: T; cols: [keyof T & string, string][] }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small" style={{ fontWeight: 600 }}>{title}</span>
      {rows.length > 0 && (
        <table className="grid edit">
          <thead><tr>{cols.map(([k, l]) => <th key={k} className={typeof blank[k] === 'string' ? '' : 'right'}>{l}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map(([k]) => {
                  const upd = (v: unknown) => onChange(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                  return <td key={k} className={typeof blank[k] === 'string' ? '' : 'tight'}>
                    {typeof blank[k] === 'string' ? <input className="bare" value={r[k] ?? ''} onChange={(e) => upd(e.target.value)} />
                      : typeof blank[k] === 'boolean' ? <input type="checkbox" checked={!!r[k]} onChange={(e) => upd(e.target.checked)} />
                      : <NumberInput className="bare" style={{ width: 90 }} value={r[k] ?? null} onChange={upd} />}
                  </td>;
                })}
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
