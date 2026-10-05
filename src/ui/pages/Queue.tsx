// A department's queue: the quotes waiting on its prices, the most urgent first.
import { get } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import type { DepartmentKey, QueueItem } from '../lib/types.ts';
import { DeptChip, Due, ErrorBanner, useApp } from '../components/ui.tsx';
import { ago } from '../lib/format.ts';
import { href } from '../lib/router.ts';

export function Queue({ department }: { department: string | null }) {
  const app = useApp();
  const dept = (department ?? app.account.department ?? 'metals') as DepartmentKey;
  const { data, error } = useAsync(() => get<QueueItem[]>(`/queue/${dept}`), [dept]);
  const open = (data ?? []).filter((q) => q.status !== 'answered');
  const done = (data ?? []).filter((q) => q.status === 'answered');
  const name = app.deptName(dept);
  return (
    <div className="page narrow">
      <div className="hello">
        <div>
          <h1>{name} queue</h1>
          <p>{data ? (open.length ? `${open.length} quote${open.length === 1 ? '' : 's'} waiting on ${name}'s prices.` : `Nothing is waiting on ${name}.`) : 'Loading…'}</p>
        </div>
        {app.account.role !== 'estimator' && (
          <div className="seg">
            {app.departments.map((d) => <button key={d.key} className={d.key === dept ? 'on' : ''} onClick={() => { location.hash = href('/queue', { department: d.key }); }}>{d.name.replace(' (ADC)', '')}</button>)}
          </div>
        )}
      </div>
      <ErrorBanner error={error} />
      <div className="section" style={{ marginBottom: 16 }}>
        <table className="grid">
          <thead><tr><th>Quote</th><th>Customer</th><th>Parts priced</th><th>Needed by</th><th>For</th><th>Status</th></tr></thead>
          <tbody>
            {open.map((q) => (
              <tr key={q.requestId} className="click" onClick={() => { location.hash = `#/quotes/${q.quoteId}`; }}>
                <td className="tight"><a className="mono" href={`#/quotes/${q.quoteId}`}>{q.number}</a>{q.itar && <> <span className="chip itar">ITAR</span></>}</td>
                <td><b>{q.customerName}</b><div className="sub">{q.title}</div></td>
                <td className="tight">{q.priced} of {q.lines}</td>
                <td className="tight">{q.neededBy ? <Due date={q.neededBy} /> : <span className="muted small">not given</span>}</td>
                <td className="tight">{q.ownerName}<div className="sub">sent {ago(q.sentAt)}</div></td>
                <td className="tight"><DeptChip dept={dept} status={q.status} />{q.status === 'question' && <div className="sub">waiting on {q.ownerName.split(' ')[0]}</div>}</td>
              </tr>
            ))}
            {data && open.length === 0 && <tr><td colSpan={6} className="empty">All caught up.</td></tr>}
          </tbody>
        </table>
      </div>
      {done.length > 0 && (
        <div className="section">
          <header><h2>Priced in the last 30 days</h2></header>
          <table className="grid">
            <tbody>
              {done.map((q) => (
                <tr key={q.requestId} className="click" onClick={() => { location.hash = `#/quotes/${q.quoteId}`; }}>
                  <td className="tight mono">{q.number}</td>
                  <td>{q.customerName} <span className="muted">· {q.title}</span></td>
                  <td className="tight muted">{q.lines} part{q.lines === 1 ? '' : 's'}</td>
                  <td className="tight">{q.ownerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
