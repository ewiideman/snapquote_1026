// The board: every open quote, by where it stands, with what each is waiting on. Business development's
// home page, and where a quote starts: drop the RFQ email or files on it.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, post, upload, message } from '../lib/api.ts';
import { useAsync, stored } from '../lib/useAsync.ts';
import type { BoardCard, DepartmentKey, DropResult, Stage } from '../lib/types.ts';
import { canSell, DropStrip, Due, ErrorBanner, Icon, useApp, type IconName } from '../components/ui.tsx';
import { usdShort, ago, daysUntil, fileSize, shortDate } from '../lib/format.ts';

const COLUMNS: { key: string; title: string; stages: Stage[]; empty: string }[] = [
  { key: 'draft', title: 'Drafting', stages: ['draft'], empty: 'No drafts. Drop an RFQ above, or start a new quote.' },
  { key: 'estimating', title: 'With departments', stages: ['estimating'], empty: 'Nothing is out with the departments for prices.' },
  { key: 'ready', title: 'Ready to send', stages: ['ready'], empty: 'Nothing to send yet. A quote lands here once every department has priced it.' },
  { key: 'sent', title: 'With the customer', stages: ['sent'], empty: 'No quotes are waiting on a customer.' },
  { key: 'closed', title: 'Closed lately', stages: ['won', 'lost', 'no_bid'], empty: 'Nothing won, lost or declined in the last 45 days.' },
];

/** Starts a quote from dropped files and says what was taken from them. */
export async function startQuote(files: File[], toast: (t: string) => void): Promise<number> {
  const { id } = await post<{ id: number }>('/quotes');
  let lines = 0;
  let repeats = 0;
  let from: string | null = null;
  const unread: string[] = [];
  for (const f of files) {
    try {
      const r = await upload<DropResult>(`/quotes/${id}/files`, f);
      lines += r.linesAdded.reduce((s, l) => s + l.lineIds.length, 0);
      repeats += r.linesAdded.reduce((s, l) => s + l.alreadyOnQuote, 0);
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
  toast(`${said}.${repeats ? ` ${repeats} part${repeats === 1 ? ' was' : 's were'} in more than one file and added once.` : ''}${unread.length ? ` Attached but not read: ${unread.join(', ')}.` : ''}`);
  return id;
}

type Tone = 'do' | 'ask' | 'fix' | 'wait' | 'done' | 'late' | 'plain';

/** What a quote needs next, from what the board knows about it, and nothing past that. */
function nextOf(c: BoardCard, short: (k: DepartmentKey) => string): { text: string; tone: Tone; icon: IconName } {
  switch (c.stage) {
    case 'draft':
      if (!c.customerName && !c.lineCount) return { text: 'Add the customer and parts', tone: 'fix', icon: 'alert' };
      if (!c.customerName) return { text: 'Add the customer', tone: 'fix', icon: 'alert' };
      if (!c.lineCount) return { text: 'Add the parts', tone: 'fix', icon: 'alert' };
      return { text: 'Finish the draft', tone: 'plain', icon: 'arrow' };
    case 'estimating': {
      const [one] = c.questionsFrom;
      if (c.questionsFrom.length === 1 && one) return { text: `Answer ${short(one)}'s question`, tone: 'ask', icon: 'question' };
      if (c.questionsFrom.length > 1) return { text: `Answer ${c.questionsFrom.length} questions`, tone: 'ask', icon: 'question' };
      if (c.neededBy) {
        const past = daysUntil(c.neededBy) < 0;
        return { text: `Prices ${past ? 'were ' : ''}needed ${shortDate(c.neededBy)}`, tone: past ? 'late' : 'wait', icon: 'clock' };
      }
      return { text: 'Waiting on prices', tone: 'wait', icon: 'clock' };
    }
    case 'ready': return { text: 'Review and send', tone: 'do', icon: 'send' };
    case 'sent': return { text: c.sentAt ? `Sent ${ago(c.sentAt)}` : 'Sent', tone: 'wait', icon: 'send' };
    case 'won': return { text: c.closedAt ? `Won ${ago(c.closedAt)}` : 'Won', tone: 'done', icon: 'done' };
    case 'lost': return { text: c.closedAt ? `Lost ${ago(c.closedAt)}` : 'Lost', tone: 'plain', icon: 'close' };
    case 'no_bid': return { text: c.closedAt ? `No bid, ${ago(c.closedAt)}` : 'No bid', tone: 'plain', icon: 'close' };
  }
}

const DEPT_STATE = {
  done: { icon: 'done', words: 'priced' },
  ask: { icon: 'question', words: 'has a question' },
  wait: { icon: 'clock', words: 'working' },
} as const;

function Card({ c }: { c: BoardCard }) {
  const app = useApp();
  const short = (k: DepartmentKey) => app.deptName(k).replace(' (ADC)', '');
  const open = c.stage === 'draft' || c.stage === 'estimating' || c.stage === 'ready';
  const next = nextOf(c, short);
  const value = c.stage === 'won' ? c.awardAmount : c.stage === 'sent' ? c.firstTotal : null;
  return (
    <a className="qcard" href={`#/quotes/${c.id}`}>
      <div className="qcard-head">
        {c.customerName
          ? <span className="cust">{c.customerName}</span>
          : <span className="cust missing"><Icon name="alert" />Customer not set</span>}
        {c.itar && <span className="tag-itar" title="ITAR: export-controlled">ITAR</span>}
      </div>
      <div className={`title${c.title ? '' : ' untitled'}`}>
        {c.title || (c.lineCount ? `${c.lineCount} part${c.lineCount === 1 ? '' : 's'}, no title yet` : 'No title or parts yet')}
      </div>
      <div className="meta">
        <span className="who-num"><span className="mono">{c.number}{c.revision ? ` rev ${c.revision}` : ''}</span><span aria-hidden="true"> · </span><span title={`Owner: ${c.ownerName}`}>{c.ownerName.split(' ')[0]}</span></span>
        {open && <span title={`Last changed ${new Date(c.updatedAt).toLocaleString('en-US')}`}>{ago(c.updatedAt)}</span>}
      </div>
      <div className="status">
        {c.stage === 'estimating' && c.departments.length > 0 && (
          <ul className="depts" aria-label="Departments">
            {c.departments.map((d) => {
              const st = c.questionsFrom.includes(d) ? 'ask' : c.waitingOn.includes(d) ? 'wait' : 'done';
              return (
                <li key={d} className={`dept ${st}`}>
                  <Icon name={DEPT_STATE[st].icon} />
                  <span className="name">{short(d)}</span>
                  <span className="state">{DEPT_STATE[st].words}</span>
                </li>
              );
            })}
          </ul>
        )}
        {open && c.customerDueOn && <div className="foot"><Due date={c.customerDueOn} plain /></div>}
        <div className="foot">
          <span className={`act ${next.tone}`}><Icon name={next.icon} /><span>{next.text}</span></span>
          {value !== null && <span className="value" title={c.stage === 'won' ? 'Award amount' : `Total at ${c.firstQuantity ?? 'the first quantity'}`}>{usdShort(value)}</span>}
        </div>
      </div>
    </a>
  );
}

/** The columns, scrolling sideways inside themselves when the window is too narrow for all five. */
function BoardScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    const col = el?.querySelector<HTMLElement>('.column');
    el?.scrollBy({ left: dir * ((col?.offsetWidth ?? 240) + 10), behavior: 'smooth' });
  };
  const scrolls = edges.left || edges.right;
  return (
    <div className={`board-wrap${edges.left ? ' more-left' : ''}${edges.right ? ' more-right' : ''}`}>
      <div className="board" ref={ref} role="region" aria-label={scrolls ? 'Quotes by stage, scrolls sideways' : 'Quotes by stage'} tabIndex={scrolls ? 0 : undefined}>{children}</div>
      {edges.left && <button type="button" className="board-nudge left" aria-label="Show earlier stages" title="Earlier stages" onClick={() => nudge(-1)}><Icon name="left" /></button>}
      {edges.right && <button type="button" className="board-nudge right" aria-label="Show later stages" title="Later stages" onClick={() => nudge(1)}><Icon name="right" /></button>}
    </div>
  );
}

const FOCUS_LABEL: Record<string, string> = { attention: 'Needs attention', estimating: 'With departments', sent: 'With customers', late: 'Overdue', won: 'Won in the last 45 days' };
const needsAttention = (c: BoardCard) => c.stage === 'ready' || c.questionsFrom.length > 0;
const overdue = (c: BoardCard) => ['draft', 'estimating', 'ready'].includes(c.stage) && !!c.customerDueOn && daysUntil(c.customerDueOn) < 0;

export function Board() {
  const app = useApp();
  const seller = canSell(app.account);
  const { data, error } = useAsync(() => get<BoardCard[]>('/board'), []);
  const [mine, setMine] = useState(() => (stored('board.mine') ?? (app.account.role === 'sales' ? 'mine' : 'all')) === 'mine');
  const [focus, setFocus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Files dropped for the next quote, held until the person starts it: an RFQ is often several files
  // picked or dropped one at a time.
  const [staged, setStaged] = useState<File[]>([]);
  const stage = (files: File[]) => setStaged((now) => [...now, ...files.filter((f) => !now.some((x) => x.name === f.name && x.size === f.size))]);
  const [startError, setStartError] = useState<unknown>(null);

  const cards = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => !mine || c.ownerId === app.account.id)
      .filter((c) => !s || [c.number, c.customerName ?? '', c.title, c.ownerName].some((x) => x.toLowerCase().includes(s)));
  }, [data, mine, search, app.account.id]);

  const tally = {
    attention: cards.filter(needsAttention).length,
    estimating: cards.filter((c) => c.stage === 'estimating').length,
    sent: cards.filter((c) => c.stage === 'sent').length,
    late: cards.filter(overdue).length,
    wonValue: cards.filter((c) => c.stage === 'won').reduce((s, c) => s + (c.awardAmount ?? 0), 0),
  };
  const focused = (c: BoardCard) =>
    focus === null ? true
      : focus === 'attention' ? needsAttention(c)
        : focus === 'late' ? overdue(c)
          : c.stage === focus;
  const order = (a: BoardCard, b: BoardCard) => {
    const att = (c: BoardCard) => (c.questionsFrom.length > 0 ? 0 : 1);
    return att(a) - att(b) || (a.customerDueOn ?? '9999').localeCompare(b.customerDueOn ?? '9999') || b.updatedAt.localeCompare(a.updatedAt);
  };
  const shown = cards.filter(focused).length;
  const filtered = focus !== null || search.trim() !== '';
  // The same rule as the count beside Quotes in the sidebar: your own quotes, or every quote for a manager.
  const yours = (data ?? []).filter((c) => (c.ownerId === app.account.id || app.account.role !== 'sales') && needsAttention(c)).length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const start = async (files: File[]) => {
    setBusy(files.length ? `Reading ${files.length === 1 ? files[0]?.name : `${files.length} files`}…` : 'Starting…');
    setStartError(null);
    try {
      const id = await startQuote(files, app.toast);
      setStaged([]);
      location.hash = `#/quotes/${id}`;
    } catch (err) {
      setStartError(err);
      setBusy(null);
    }
  };

  const metric = (key: string, value: ReactNode, label: string, definition: string, tone?: 'attention' | 'late') => (
    <button type="button" className={`metric${tone ? ` ${tone}` : ''}${value === 0 || value === '$0' ? ' zero' : ''}`} aria-pressed={focus === key}
      title={`${definition}. ${focus === key ? 'Click to show every quote.' : 'Click to show only these.'}`}
      onClick={() => setFocus(focus === key ? null : key)}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{tone && <span className="dot" aria-hidden="true" />}{label}</span>
      <span className="sr">: {definition}</span>
    </button>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Quotes</h1>
          <p>
            {seller
              ? `${greeting}, ${app.account.displayName.split(' ')[0]}. ${yours > 0 ? `${yours} quote${yours === 1 ? ' needs' : 's need'} you: ready to send, or a department has a question.` : 'Nothing is waiting on you right now.'}`
              : 'Every open quote and where it stands. Your department’s work is in My queue.'}
          </p>
        </div>
        {seller && <button type="button" className="btn primary" onClick={() => start([])} disabled={!!busy}><Icon name="plus" />New quote</button>}
      </header>

      {seller && (
        <DropStrip onFiles={stage} busy={busy}
          title={staged.length ? 'Add more files, or start the quote' : 'Start a quote from an RFQ'}
          hint="Drop customer emails, spreadsheets, drawings, or models."
          actions={<button type="button" className="btn ghost" aria-expanded={help} aria-controls="intake-help" onClick={() => setHelp(!help)}><Icon name="info" />What it reads</button>}>
          <div className="strip-help" id="intake-help" hidden={!help}>
            <ul>
              <li><b>Customer emails</b> saved from Outlook (.msg or .eml). SnapQuote fills in the contact and the title, and the customer when the sender’s company is in the directory; it keeps the message on the quote and attaches what came with it.</li>
              <li><b>Parts lists and BOMs</b> (.xlsx, .xlsm or .csv), on their own or attached to the email. Each part becomes a line on the quote.</li>
              <li><b>Drawings, models and anything else</b> are attached as they are, up to 100 MB a file.</li>
            </ul>
            <p>Add as many files as you like, together or one at a time. They wait here until you start the quote.</p>
          </div>
          {staged.length > 0 && (
            <div className="strip-files">
              <div className="spread">
                <b>{staged.length === 1 ? '1 file' : `${staged.length} files`} for the new quote</b>
                <span className="row">
                  <button type="button" className="btn ghost" onClick={() => setStaged([])} disabled={!!busy}>Clear</button>
                  <button type="button" className="btn primary" onClick={() => start(staged)} disabled={!!busy}>Start the quote</button>
                </span>
              </div>
              <div className="files">
                {staged.map((f) => (
                  <div className="file" key={`${f.name}-${f.size}`}>
                    <span className="ext">{f.name.split('.').pop()?.slice(0, 4)}</span>
                    <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span className="muted small nowrap">{fileSize(f.size)}</span>
                    <button type="button" className="closex" title={`Remove ${f.name}`} aria-label={`Remove ${f.name}`} onClick={() => setStaged(staged.filter((x) => x !== f))} disabled={!!busy}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DropStrip>
      )}
      <ErrorBanner error={startError} />

      <div className="metrics" role="group" aria-label="Summary; pick one to show only those quotes">
        {metric('attention', tally.attention, mine ? 'Needs your attention' : 'Needs attention', 'Ready to send, or a department has asked a question', tally.attention > 0 ? 'attention' : undefined)}
        {metric('estimating', tally.estimating, 'With departments', 'Out with the departments for prices')}
        {metric('sent', tally.sent, 'With customers', 'Sent, waiting on the customer’s decision')}
        {metric('late', tally.late, 'Overdue', 'Not sent yet, and past the date the customer wanted the quote', tally.late > 0 ? 'late' : undefined)}
        {metric('won', usdShort(tally.wonValue), 'Won · last 45 days', 'Award amounts of the quotes won in the last 45 days')}
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Whose quotes">
          <button type="button" className={mine ? 'on' : ''} aria-pressed={mine} onClick={() => { setMine(true); stored('board.mine', 'mine'); }}>My quotes</button>
          <button type="button" className={!mine ? 'on' : ''} aria-pressed={!mine} onClick={() => { setMine(false); stored('board.mine', 'all'); }}>Everyone's</button>
        </div>
        <div className="search">
          <Icon name="search" />
          <input type="search" aria-label="Search quotes" placeholder="Search customer, number, title, owner" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {focus && (
          <span className="filter-chip">
            {FOCUS_LABEL[focus]}
            <button type="button" aria-label="Show every quote" title="Show every quote" onClick={() => setFocus(null)}><Icon name="close" /></button>
          </span>
        )}
        <span className="toolbar-end">
          <span className="muted small" aria-live="polite">{data ? `${shown} quote${shown === 1 ? '' : 's'}` : ''}</span>
          {seller && <a className="quiet-link" href="#/deleted"><Icon name="trash" />Deleted quotes</a>}
        </span>
      </div>
      <ErrorBanner error={error} />
      <BoardScroller>
        {COLUMNS.map((col) => {
          const list = cards.filter((c) => col.stages.includes(c.stage)).filter(focused).sort(order);
          return (
            <section className="column" key={col.key} aria-labelledby={`col-${col.key}`}>
              <header className="column-head">
                <h2 id={`col-${col.key}`}>{col.title}</h2>
                <span className="badge" aria-label={`${list.length} quote${list.length === 1 ? '' : 's'}`}>{list.length}</span>
              </header>
              <div className="column-body">
                {list.map((c) => <Card key={c.id} c={c} />)}
                {data && list.length === 0 && (
                  <p className="column-empty">{filtered ? 'Nothing here matches.' : col.key === 'draft' && !seller ? 'No drafts.' : col.empty}</p>
                )}
                {!data && !error && <p className="column-empty">Loading…</p>}
              </div>
            </section>
          );
        })}
      </BoardScroller>
    </div>
  );
}

/** Quotes deleted in the last 90 days, to restore one deleted by mistake. */
export function DeletedQuotes() {
  const app = useApp();
  const { data, error, reload } = useAsync(() => get<{ id: number; number: string; revision: number; customerName: string | null; title: string; ownerName: string; deletedAt: string; deletedByName: string | null; deleteReason: string | null }[]>('/deleted-quotes'), []);
  const [actionError, setActionError] = useState<unknown>(null);
  return (
    <div className="page narrow stack">
      <p><a href="#/">Quotes</a> / Deleted</p>
      <h1>Deleted quotes</h1>
      <p className="muted">The last 90 days. A restored quote goes back where it was, with any department requests its deletion withdrew.</p>
      <ErrorBanner error={error ?? actionError} />
      {data && data.length === 0 && <div className="empty">Nothing deleted.</div>}
      {data && data.length > 0 && (
        <table className="grid card">
          <thead><tr><th>Quote</th><th>Customer</th><th>Deleted</th><th>Why</th><th /></tr></thead>
          <tbody>
            {data.map((q) => (
              <tr key={q.id}>
                <td><a className="mono" href={`#/quotes/${q.id}`}>{q.number}{q.revision ? ` rev ${q.revision}` : ''}</a><div className="muted small">{q.title}</div></td>
                <td>{q.customerName ?? <span className="muted">—</span>}</td>
                <td className="small">{q.deletedByName}, {ago(q.deletedAt)}</td>
                <td className="small">{q.deleteReason ?? ''}</td>
                <td className="right"><button className="btn small" onClick={async () => {
                  setActionError(null);
                  try { await post(`/quotes/${q.id}/restore`); app.toast(`${q.number} restored.`); app.refreshCounts(); reload(); } catch (err) { setActionError(err); }
                }}>Restore</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
