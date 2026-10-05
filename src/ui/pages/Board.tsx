// The board: every open quote, by where it stands, with what each is waiting on. Business development's
// home page, and where a quote starts: drop the RFQ email or files on it.
import { useMemo, useState } from 'react';
import { get, post, upload, message } from '../lib/api.ts';
import { useAsync, stored } from '../lib/useAsync.ts';
import type { BoardCard, DropResult, Stage } from '../lib/types.ts';
import { canSell, DeptChip, DropZone, Due, ErrorBanner, useApp } from '../components/ui.tsx';
import { usdShort, ago, daysUntil } from '../lib/format.ts';

const COLUMNS: { key: string; title: string; stages: Stage[] }[] = [
  { key: 'draft', title: 'Drafting', stages: ['draft'] },
  { key: 'estimating', title: 'With the departments', stages: ['estimating'] },
  { key: 'ready', title: 'Ready to send', stages: ['ready'] },
  { key: 'sent', title: 'With the customer', stages: ['sent'] },
  { key: 'closed', title: 'Closed lately', stages: ['won', 'lost', 'no_bid'] },
];

/** Starts a quote from dropped files and says what was taken from them. */
export async function startQuote(files: File[], toast: (t: string) => void): Promise<number> {
  const { id } = await post<{ id: number }>('/quotes');
  let lines = 0;
  let from: string | null = null;
  const unread: string[] = [];
  for (const f of files) {
    try {
      const r = await upload<DropResult>(`/quotes/${id}/files`, f);
      lines += r.linesAdded.reduce((s, l) => s + l.lineIds.length, 0);
      if (r.fromEmail) from = r.fromEmail.from;
      unread.push(...r.notRead.map((n) => n.fileName));
    } catch (err) {
      unread.push(`${f.name} (${message(err)})`);
    }
  }
  if (!files.length) return id;
  const said = [
    `Started a quote with ${files.length === 1 ? '1 file' : `${files.length} files`}`,
    from ? `from ${from}` : '',
    lines ? `and ${lines} part${lines === 1 ? '' : 's'} from the parts list` : '',
  ].filter(Boolean).join(' ');
  toast(`${said}.${unread.length ? ` Attached but not read: ${unread.join(', ')}.` : ''}`);
  return id;
}

function Card({ c }: { c: BoardCard }) {
  const attention = c.stage === 'ready' || c.questionsFrom.length > 0;
  const closed = c.stage === 'won' || c.stage === 'lost' || c.stage === 'no_bid';
  return (
    <a className={`qcard${attention ? ' attention' : ''}`} href={`#/quotes/${c.id}`}>
      <div className="top">
        <span className="mono">{c.number}{c.revision ? ` rev ${c.revision}` : ''}</span>
        <span>{c.ownerName.split(' ')[0]}</span>
      </div>
      <div className="cust">{c.customerName ?? <span className="muted">No customer yet</span>}</div>
      <div className="title">{c.title || `${c.lineCount} part${c.lineCount === 1 ? '' : 's'}`}</div>
      {(c.departments.length > 0 || c.itar || (!closed && c.customerDueOn)) && (
        <div className="chips">
          {c.itar && <span className="chip itar">ITAR</span>}
          {c.stage === 'estimating' && c.departments.map((d) => <DeptChip key={d} dept={d} status={c.questionsFrom.includes(d) ? 'question' : c.waitingOn.includes(d) ? 'open' : 'answered'} />)}
          {!closed && c.stage !== 'sent' && <Due date={c.customerDueOn} />}
        </div>
      )}
      <div className="foot">
        <span>{closed ? (c.stage === 'won' ? 'Won' : c.stage === 'lost' ? 'Lost' : 'No bid') : c.stage === 'sent' ? `Sent ${ago(c.updatedAt)}` : ago(c.updatedAt)}</span>
        <span className="price">{c.stage === 'won' && c.awardAmount !== null ? usdShort(c.awardAmount) : c.firstTotal !== null ? usdShort(c.firstTotal) : ''}</span>
      </div>
    </a>
  );
}

export function Board() {
  const app = useApp();
  const seller = canSell(app.account);
  const { data, error } = useAsync(() => get<BoardCard[]>('/board'), []);
  const [mine, setMine] = useState(() => (stored('board.mine') ?? (app.account.role === 'sales' ? 'mine' : 'all')) === 'mine');
  const [focus, setFocus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<unknown>(null);

  const cards = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => !mine || c.ownerId === app.account.id)
      .filter((c) => !s || [c.number, c.customerName ?? '', c.title, c.ownerName].some((x) => x.toLowerCase().includes(s)));
  }, [data, mine, search, app.account.id]);

  const tally = {
    attention: cards.filter((c) => c.stage === 'ready' || c.questionsFrom.length > 0).length,
    estimating: cards.filter((c) => c.stage === 'estimating').length,
    sent: cards.filter((c) => c.stage === 'sent').length,
    late: cards.filter((c) => ['draft', 'estimating', 'ready'].includes(c.stage) && c.customerDueOn && daysUntil(c.customerDueOn) < 0).length,
    wonValue: cards.filter((c) => c.stage === 'won').reduce((s, c) => s + (c.awardAmount ?? 0), 0),
  };
  const focused = (c: BoardCard) =>
    focus === null ? true
      : focus === 'attention' ? c.stage === 'ready' || c.questionsFrom.length > 0
        : focus === 'late' ? ['draft', 'estimating', 'ready'].includes(c.stage) && !!c.customerDueOn && daysUntil(c.customerDueOn) < 0
          : c.stage === focus;
  const order = (a: BoardCard, b: BoardCard) => {
    const att = (c: BoardCard) => (c.questionsFrom.length > 0 ? 0 : 1);
    return att(a) - att(b) || (a.customerDueOn ?? '9999').localeCompare(b.customerDueOn ?? '9999') || b.updatedAt.localeCompare(a.updatedAt);
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const start = async (files: File[]) => {
    setBusy(files.length ? `Reading ${files.length === 1 ? files[0]?.name : `${files.length} files`}…` : 'Starting…');
    setStartError(null);
    try {
      const id = await startQuote(files, app.toast);
      location.hash = `#/quotes/${id}`;
    } catch (err) {
      setStartError(err);
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="hello">
        <div>
          <h1>{greeting}, {app.account.displayName.split(' ')[0]}</h1>
          <p>{tally.attention > 0 ? `${tally.attention} quote${tally.attention === 1 ? ' needs' : 's need'} you: ready to send, or a department has a question.` : 'Nothing is waiting on you right now.'}</p>
        </div>
        {seller && <button className="btn" onClick={() => start([])} disabled={!!busy}>Start a blank quote</button>}
      </div>
      {seller && (
        <DropZone onFiles={start} busy={busy} title="Drop an RFQ here to start a quote"
          hint="The customer's email from Outlook, a parts list or BOM spreadsheet, drawings, models — SnapQuote reads the email and the parts list for you." />
      )}
      <ErrorBanner error={startError} />

      <div className="tally">
        <button className={`attn${focus === 'attention' ? ' on' : ''}`} onClick={() => setFocus(focus === 'attention' ? null : 'attention')}><b>{tally.attention}</b><span>Need you</span></button>
        <button className={focus === 'estimating' ? 'on' : ''} onClick={() => setFocus(focus === 'estimating' ? null : 'estimating')}><b>{tally.estimating}</b><span>With the departments</span></button>
        <button className={focus === 'sent' ? 'on' : ''} onClick={() => setFocus(focus === 'sent' ? null : 'sent')}><b>{tally.sent}</b><span>With customers</span></button>
        <button className={focus === 'late' ? 'on' : ''} onClick={() => setFocus(focus === 'late' ? null : 'late')}><b style={tally.late ? { color: 'var(--late)' } : undefined}>{tally.late}</b><span>Past the customer's date</span></button>
        <button className={focus === 'won' ? 'on' : ''} onClick={() => setFocus(focus === 'won' ? null : 'won')}><b>{usdShort(tally.wonValue)}</b><span>Won in the last 45 days</span></button>
      </div>
      <div className="filters">
        <div className="seg">
          <button className={mine ? 'on' : ''} onClick={() => { setMine(true); stored('board.mine', 'mine'); }}>My quotes</button>
          <button className={!mine ? 'on' : ''} onClick={() => { setMine(false); stored('board.mine', 'all'); }}>Everyone's</button>
        </div>
        <input placeholder="Find a customer, quote number or person" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 300 }} />
        {focus && <button className="link" onClick={() => setFocus(null)}>Show all</button>}
      </div>
      <ErrorBanner error={error} />
      <div className="columns">
        {COLUMNS.map((col) => {
          const list = cards.filter((c) => col.stages.includes(c.stage)).filter(focused).sort(order);
          return (
            <section className="column" key={col.key}>
              <h3>{col.title}<span>{list.length}</span></h3>
              {list.map((c) => <Card key={c.id} c={c} />)}
              {data && list.length === 0 && <div className="muted small" style={{ padding: '6px 6px 10px' }}>None</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
