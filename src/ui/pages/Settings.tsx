// Administrators: who can sign in, the terms printed on the customer's copy, and the Metals rates.
import { useEffect, useState } from 'react';
import { get, patch, post, put } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { Role } from '../lib/types.ts';
import { Dialog, ErrorBanner, NumberInput, useApp } from '../components/ui.tsx';
import { ago } from '../lib/format.ts';

const ROLE_NAMES: Record<Role, string> = { sales: 'Business development', estimator: 'Estimator', manager: 'Manager', administrator: 'Administrator' };

interface Listing { id: string; displayName: string; role: Role; department: string | null; email: string | null; canSignIn: boolean; disabledAt: string | null; lastSignedInAt: string | null }

function Accounts() {
  const app = useApp();
  const list = useAsync(() => get<Listing[]>('/users'), []);
  const [f, setF] = useState({ id: '', displayName: '', role: 'sales' as Role, department: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [passwordFor, setPasswordFor] = useState<Listing | null>(null);
  const [temp, setTemp] = useState('');
  const act = async (fn: () => Promise<unknown>, said: string) => {
    setError(null);
    try { await fn(); list.reload(); app.toast(said); } catch (err) { setError(err); }
  };
  return (
    <div className="section">
      <header><h2>People</h2><span className="muted small">A password you set is temporary: they choose their own when they first sign in.</span></header>
      <table className="grid">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Department</th><th>Last signed in</th><th /></tr></thead>
        <tbody>
          {(list.data ?? []).map((a) => (
            <tr key={a.id} style={a.disabledAt ? { opacity: 0.55 } : undefined}>
              <td><b>{a.displayName}</b><div className="sub">{a.email}</div></td>
              <td className="mono">{a.id}</td>
              <td><select className="bare" value={a.role} onChange={(e) => act(() => patch(`/users/${a.id}`, { role: e.target.value, department: e.target.value === 'estimator' ? a.department ?? 'metals' : a.department }), `${a.displayName} is now ${ROLE_NAMES[e.target.value as Role]}.`)}>
                {(Object.keys(ROLE_NAMES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
              </select></td>
              <td><select className="bare" value={a.department ?? ''} onChange={(e) => act(() => patch(`/users/${a.id}`, { department: e.target.value || null }), `Department changed for ${a.displayName}.`)}>
                <option value="">—</option>
                {app.departments.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
              </select></td>
              <td className="muted small">{a.lastSignedInAt ? ago(a.lastSignedInAt) : a.canSignIn ? 'never' : 'cannot sign in'}</td>
              <td className="tight">
                <button className="btn small ghost" onClick={() => setPasswordFor(a)}>Set password</button>
                {a.id !== app.account.id && <button className="btn small ghost" onClick={() => act(() => patch(`/users/${a.id}`, { disabled: !a.disabledAt }), a.disabledAt ? `${a.displayName} can sign in again.` : `${a.displayName} can no longer sign in.`)}>{a.disabledAt ? 'Enable' : 'Disable'}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="body stack" style={{ borderTop: '1px solid var(--line)' }}>
        <b>Add someone</b>
        <div className="grid3">
          <label className="field">Name<input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value, id: f.id || '' })} placeholder="Jon Whitney" /></label>
          <label className="field">Username<input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase() })} placeholder={f.displayName ? f.displayName.toLowerCase().trim().replace(/\s+/g, '.') : 'jon.whitney'} /></label>
          <label className="field">Email<input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Printed on quotes they send" /></label>
          <label className="field">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(Object.keys(ROLE_NAMES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select></label>
          <label className="field">Department{f.role === 'estimator' ? '' : ' (estimators)'}<select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">—</option>{app.departments.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}</select></label>
          <label className="field">Temporary password (at least 8 characters)<input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        </div>
        <ErrorBanner error={error} />
        {passwordFor && (
          <Dialog title={`Temporary password for ${passwordFor.displayName}`} onClose={() => { setPasswordFor(null); setTemp(''); }} footer={<>
            <button className="btn" onClick={() => { setPasswordFor(null); setTemp(''); }}>Cancel</button>
            <button className="btn primary" disabled={temp.length < 8} onClick={() => { const who = passwordFor; void act(() => patch(`/users/${who.id}`, { password: temp }), `Temporary password set for ${who.displayName}.`); setPasswordFor(null); setTemp(''); }}>Set it</button>
          </>}>
            <p className="muted">Tell them in person or by phone. They choose their own the first time they sign in, and any session they have open now ends.</p>
            <label className="field">Temporary password (at least 8 characters)<input value={temp} onChange={(e) => setTemp(e.target.value)} autoFocus /></label>
          </Dialog>
        )}
        <div className="row"><button className="btn primary" disabled={!f.displayName.trim() || f.password.length < 8} onClick={() => act(async () => {
          await post('/users', { ...f, id: f.id || f.displayName.toLowerCase().trim().replace(/\s+/g, '.'), department: f.department || null });
          setF({ id: '', displayName: '', role: 'sales', department: '', email: '', password: '' });
        }, `${f.displayName} added.`)}>Add</button>
          {(() => {
            const missing = [!f.displayName.trim() && 'a name', f.password.length < 8 && `a temporary password of at least 8 characters${f.password ? ` (${f.password.length} so far)` : ''}`].filter(Boolean);
            return missing.length > 0 && (f.displayName || f.password || f.id || f.email) ? <span className="muted small" style={{ marginLeft: 10 }}>Still needed: {missing.join(' and ')}.</span> : null;
          })()}
        </div>
      </div>
    </div>
  );
}

function Terms() {
  const app = useApp();
  const { data } = useAsync(() => get<{ text: string }>('/settings/terms'), []);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (data) setText(data.text); }, [data]);
  return (
    <div className="section">
      <header><h2>Terms on the customer's copy</h2><span className="muted small">Printed at the end of every quote PDF. Leave empty to print none.</span></header>
      <div className="body stack">
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Prices valid for 30 days. FOB Arlington, VT. Payment terms net 30." />
        <ErrorBanner error={error} />
        <div><button className="btn primary" disabled={!data || text === data.text} onClick={async () => { try { await put('/settings/terms', { text }); app.toast('Terms saved.'); } catch (err) { setError(err); } }}>Save terms</button></div>
      </div>
    </div>
  );
}

interface Ref { department: string; kind: string; key: string; data: any; active: boolean; updatedAt: string; updatedByName: string | null }

function MetalsRates() {
  const app = useApp();
  const rows = useAsync(() => get<Ref[]>('/reference/metals'), []);
  const [tab, setTab] = useState<'work_cell' | 'material'>('work_cell');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = async (r: Ref, data: any, active = r.active) => {
    setError(null);
    try { await put(`/reference/metals/${r.kind}/${encodeURIComponent(r.key)}`, { data, active }); rows.reload(); app.toast(`${r.key} saved.`); } catch (err) { setError(err); }
  };
  const list = (rows.data ?? []).filter((r) => r.kind === tab).filter((r) => !search || `${r.key} ${r.data.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="section">
      <header>
        <h2>Metals rates</h2>
        <div className="row"><div className="seg"><button className={tab === 'work_cell' ? 'on' : ''} onClick={() => setTab('work_cell')}>Work cells</button><button className={tab === 'material' ? 'on' : ''} onClick={() => setTab('material')}>Sheet stock</button></div>
          <input placeholder="Find" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </header>
      <ErrorBanner error={error} />
      <div style={{ maxHeight: 520, overflow: 'auto' }}>
        <table className="grid">
          <thead>{tab === 'work_cell'
            ? <tr><th>Work cell</th><th className="right">Rate ($/hour, loaded)</th><th className="right">Standard setup (hours)</th><th>Changed</th><th>In use</th></tr>
            : <tr><th>Item</th><th>Description</th><th className="right">Price per sheet</th><th>Changed</th><th>In use</th></tr>}</thead>
          <tbody>
            {list.map((r) => tab === 'work_cell' ? (
              <tr key={r.key}>
                <td><b>{r.key}</b></td>
                <td className="right"><RateInput value={r.data.hourlyCellRate} onSave={(v) => save(r, { ...r.data, hourlyCellRate: v })} /></td>
                <td className="right"><RateInput value={r.data.setUpTimeHours} onSave={(v) => save(r, { ...r.data, setUpTimeHours: v })} /></td>
                <td className="muted small">{r.updatedByName ? `${r.updatedByName}, ${ago(r.updatedAt)}` : 'as imported'}</td>
                <td><input type="checkbox" checked={r.active} onChange={(e) => save(r, r.data, e.target.checked)} /></td>
              </tr>
            ) : (
              <tr key={r.key}>
                <td className="mono">{r.key}</td>
                <td className="small">{r.data.description}</td>
                <td className="right">{r.data.priceUsd === null ? <span className="muted small">no price</span> : null}<RateInput value={r.data.priceUsd} onSave={(v) => save(r, { ...r.data, priceUsd: v })} prefix="$" /></td>
                <td className="muted small">{r.updatedByName ? `${r.updatedByName}, ${ago(r.updatedAt)}` : 'as imported'}</td>
                <td><input type="checkbox" checked={r.active} onChange={(e) => save(r, r.data, e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="body muted small">Work cells and sheet stock came from the old SnapQuote (rate sheet Rev F and the XA purchase history). Changes apply to prices worked out from now on; saved prices keep what they were worked out with.</div>
    </div>
  );
}

function MoldingRates() {
  const app = useApp();
  const rows = useAsync(() => get<Ref[]>('/reference/molding'), []);
  const [tab, setTab] = useState<'resin' | 'press'>('resin');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = async (r: Ref, data: any, active = r.active) => {
    setError(null);
    try { await put(`/reference/molding/${r.kind}/${encodeURIComponent(r.key)}`, { data, active }); rows.reload(); app.toast(`${r.key} saved.`); } catch (err) { setError(err); }
  };
  const list = (rows.data ?? []).filter((r) => r.kind === tab).filter((r) => !search || `${r.key} ${r.data.plant ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.data.sortOrder ?? 0) - (b.data.sortOrder ?? 0));
  return (
    <div className="section">
      <header>
        <h2>Molding (ADC) rates</h2>
        <div className="row"><div className="seg"><button className={tab === 'resin' ? 'on' : ''} onClick={() => setTab('resin')}>Resins</button><button className={tab === 'press' ? 'on' : ''} onClick={() => setTab('press')}>Presses</button></div>
          <input placeholder="Find" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </header>
      <ErrorBanner error={error} />
      <div style={{ maxHeight: 520, overflow: 'auto' }}>
        <table className="grid">
          <thead>{tab === 'resin'
            ? <tr><th>Resin</th><th className="right">Price ($/lb)</th><th className="right">Density (lb/in³)</th><th>Changed</th><th>In use</th></tr>
            : <tr><th>Press</th><th>Plant</th><th className="right">Tons</th><th className="right">Barrel (oz)</th><th>Changed</th><th>In use</th></tr>}</thead>
          <tbody>
            {list.map((r) => tab === 'resin' ? (
              <tr key={r.key}>
                <td><b>{r.key}</b></td>
                <td className="right">{!(r.data.pricePerLb > 0) && <span className="muted small">no price </span>}<RateInput value={r.data.pricePerLb} onSave={(v) => save(r, { ...r.data, pricePerLb: v })} prefix="$" /></td>
                <td className="right"><RateInput value={r.data.densityLbPerIn3} onSave={(v) => save(r, { ...r.data, densityLbPerIn3: v })} /></td>
                <td className="muted small">{r.updatedByName ? `${r.updatedByName}, ${ago(r.updatedAt)}` : 'as imported'}</td>
                <td><input type="checkbox" checked={r.active} onChange={(e) => save(r, r.data, e.target.checked)} /></td>
              </tr>
            ) : (
              <tr key={r.key}>
                <td className="mono small">{r.key}</td>
                <td className="small">{r.data.plant}</td>
                <td className="right"><RateInput value={r.data.tons} onSave={(v) => save(r, { ...r.data, tons: v })} /></td>
                <td className="right"><RateInput value={r.data.barrelOz} onSave={(v) => save(r, { ...r.data, barrelOz: v })} /></td>
                <td className="muted small">{r.updatedByName ? `${r.updatedByName}, ${ago(r.updatedAt)}` : 'as imported'}</td>
                <td><input type="checkbox" checked={r.active} onChange={(e) => save(r, r.data, e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="body muted small">Resins and presses came from the old SnapQuote (ADC's Tool Development Form, press list of Mar 21, 2025). The hourly press rates and setup costs by tonnage are the form's; see docs/molding-calculator.md. Changes apply to prices worked out from now on.</div>
    </div>
  );
}

function RateInput({ value, onSave, prefix }: { value: number | null; onSave: (v: number) => void; prefix?: string }) {
  const [v, setV] = useState<number | null>(value);
  useEffect(() => setV(value), [value]);
  return (
    <span className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
      {prefix && <span className="muted">{prefix}</span>}
      <NumberInput className="bare" style={{ width: 100 }} value={v} onChange={setV} />
      {v !== value && v !== null && v >= 0 && <button className="btn small primary" onClick={() => onSave(v)}>Save</button>}
    </span>
  );
}

interface SchedulerStatus { capacity: { connected: boolean; file?: { writtenAt: string } | null; problem?: string | null }; exchange: { dir: string; lastWrittenAt: string | null; quotes: number | null; error: string | null } | null }

function SchedulerLink() {
  const app = useApp();
  const { data, reload } = useAsync(() => get<SchedulerStatus>('/scheduler'), []);
  const [error, setError] = useState<unknown>(null);
  if (!data) return null;
  const x = data.exchange;
  return (
    <div className="section">
      <header><h2>Production Scheduler</h2>{x && <button className="btn small" onClick={async () => { setError(null); try { await post('/scheduler/write'); reload(); app.toast('Quotes written for the scheduler.'); } catch (err) { setError(err); } }}>Write quotes now</button>}</header>
      <div className="body stack" style={{ gap: 6 }}>
        {!x ? <span>Not linked: set MACK_EXCHANGE_DIR on this server to the folder the scheduler also uses.</span> : (
          <>
            <span>Folder: <span className="mono">{x.dir}</span></span>
            <span>Quotes for the scheduler: {x.error ? <b style={{ color: 'var(--late)' }}>{x.error}</b> : x.lastWrittenAt ? `${x.quotes} written ${ago(x.lastWrittenAt)}` : 'not written yet'}</span>
            <span>Capacity from the scheduler: {data.capacity.file ? `written ${ago(data.capacity.file.writtenAt)}` : <b style={{ color: 'var(--soon)' }}>{data.capacity.problem}</b>}</span>
          </>
        )}
        <ErrorBanner error={error} />
      </div>
    </div>
  );
}

export function Settings() {
  return (
    <div className="page narrow stack" style={{ gap: 16 }}>
      <h1>Settings</h1>
      <Accounts />
      <Terms />
      <SchedulerLink />
      <MetalsRates />
      <MoldingRates />
    </div>
  );
}
