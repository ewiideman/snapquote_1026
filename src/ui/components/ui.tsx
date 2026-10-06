import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Account, Department, DepartmentKey, RequestStatus } from '../lib/types.ts';
import { dueTone, dueWords } from '../lib/format.ts';
import { message } from '../lib/api.ts';

// ---------------------------------------------------------------- who is signed in

export interface AppState {
  account: Account;
  departments: Department[];
  deptName: (k: string | null | undefined) => string;
  toast: (text: string, action?: { label: string; run: () => void }) => void;
  refreshCounts: () => void;
}
export const AppContext = createContext<AppState | null>(null);
export const useApp = (): AppState => {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside the app');
  return v;
};
export const canSell = (a: Account) => a.role === 'sales' || a.role === 'manager' || a.role === 'administrator';
export const ROLE_NAMES: Record<Account['role'], string> = { sales: 'Business development', estimator: 'Estimator', manager: 'Manager', administrator: 'Administrator' };
export const canEstimate = (a: Account, dept: string | null) => !!dept && ((a.role === 'estimator' && a.department === dept) || a.role === 'manager' || a.role === 'administrator');

// ---------------------------------------------------------------- small pieces

// One outline icon set: 24-unit grid, 1.75 stroke, round ends, drawn in the current text color.
const ICONS = {
  upload: <><path d="M12 15V4" /><path d="M7.5 8.5L12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  file: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  quotes: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  board: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
  inbox: <><path d="M3 13h5l1.5 2.5h5L16 13h5" /><path d="M5.5 5h13L21 13v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" /></>,
  cells: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16h.01" /></>,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.6a2.5 2.5 0 014.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01" /></>,
  done: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.3l2.4 2.4 4.6-4.9" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  send: <><path d="M20.5 3.5L10 14" /><path d="M20.5 3.5L14 20.5l-4-6.5-6.5-4z" /></>,
  left: <path d="M15 6l-6 6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></>,
  signout: <><path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4" /><path d="M9.5 16.5L5 12l4.5-4.5M5 12h11" /></>,
};
export type IconName = keyof typeof ICONS;
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="banner error" role="alert">{message(error)}</div>;
}

export function Due({ date, prefix, plain }: { date: string | null; prefix?: string; plain?: boolean }) {
  if (!date) return null;
  const tone = dueTone(date);
  if (plain) {
    const words = dueWords(date);
    return <span className={`due ${tone}`} title={`The customer wants the quote by ${date}`}><Icon name="calendar" />{words.charAt(0).toUpperCase() + words.slice(1)}</span>;
  }
  return <span className={`chip ${tone === 'ok' ? '' : tone}`} title={date}>{prefix ? `${prefix} ` : ''}{dueWords(date)}</span>;
}

const REQUEST_WORDS: Record<RequestStatus, string> = { open: 'working', question: 'has a question', answered: 'priced', withdrawn: 'withdrawn' };
export function DeptChip({ dept, status }: { dept: DepartmentKey; status: RequestStatus }) {
  const { deptName } = useApp();
  const cls = status === 'answered' ? 'done' : status === 'question' ? 'ask' : 'wait';
  return (
    <span className={`chip ${cls}`} title={`${deptName(dept)} ${REQUEST_WORDS[status]}`}>
      {status === 'answered' ? '✓' : status === 'question' ? '?' : <span className="dot" />} {deptName(dept).replace(' (ADC)', '')}
    </span>
  );
}

// ---------------------------------------------------------------- dropping files

export function DropZone({ onFiles, title, hint, compact, busy, accept }: { onFiles: (files: File[]) => void; title: string; hint: string; compact?: boolean; busy?: string | null; accept?: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop${compact ? ' compact' : ''}${over ? ' over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length && !busy) onFiles(files);
      }}
    >
      <div className="icon"><Icon name="upload" /></div>
      <div><strong>{title}</strong><span>{hint}</span></div>
      <input ref={input} type="file" multiple accept={accept} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
      {busy && <div className="busy">{busy}</div>}
    </div>
  );
}

/**
 * The intake strip: a compact drop target with its own Upload button. Files may be dropped anywhere on
 * it, several at once or one at a time; any type is taken. Children (help, files waiting) sit inside it,
 * so dropping on them works too.
 */
export function DropStrip({ onFiles, title, hint, busy, accept, actions, children }: { onFiles: (files: File[]) => void; title: ReactNode; hint: ReactNode; busy?: string | null; accept?: string; actions?: ReactNode; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop strip${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length && !busy) onFiles(files);
      }}
    >
      <div className="strip-row">
        <div className="icon"><Icon name="upload" /></div>
        <div className="strip-text"><strong>{title}</strong><span>{hint}</span></div>
        <div className="strip-actions">
          {actions}
          <button type="button" className="btn" onClick={() => input.current?.click()} disabled={!!busy}><Icon name="upload" />Upload files</button>
        </div>
      </div>
      {children}
      <input ref={input} type="file" multiple accept={accept} tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
      {over && <div className="drop-hint" aria-hidden="true">Drop to add to the new quote</div>}
      {busy && <div className="busy" role="status">{busy}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- panels and dialogs

function useEscape(onClose: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
}

export function Panel({ title, sub, onClose, children, footer }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true">
        <header>
          <div><h2>{title}</h2>{sub && <div className="muted small" style={{ marginTop: 2 }}>{sub}</div>}</div>
          <button className="closex" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </>
  );
}

export function Dialog({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true">
        <header><h2>{title}</h2></header>
        <div className="body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </>
  );
}

export function Toast({ text, action, onDone }: { text: string; action?: { label: string; run: () => void }; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, action ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [text, action, onDone]);
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      {action && <button onClick={() => { action.run(); onDone(); }}>{action.label}</button>}
    </div>
  );
}

/** A number typed in a field, kept as text while typing so "1." and "" do not jump. */
export function NumberInput({ value, onChange, className, placeholder, step, ...rest }: { value: number | null; onChange: (v: number | null) => void; className?: string; placeholder?: string; step?: string; 'aria-label'?: string; style?: React.CSSProperties }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null ? '' : String(value));
    }
  }, [value]);
  return (
    <input
      {...rest}
      className={`num ${className ?? ''}`}
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.replace(/[$,\s]/g, '');
        const n = t === '' ? null : Number(t);
        if (n === null || Number.isFinite(n)) { last.current = n; onChange(n); }
      }}
    />
  );
}

/** A full date the plant could mean: YYYY-MM-DD with a year from 2000 to 2100. */
export const plausibleDate = (v: string): boolean => /^(20\d\d|2100)-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

/**
 * A date that saves itself. While someone types, the browser reports every half-typed year (0002,
 * 0020, 0202) as a date; those are never saved. The date is saved once it is a plausible full date, or
 * when the field is left (empty clears it). The field keeps what is typed and is not redrawn under it.
 */
export function DateField({ value, onSave, ...rest }: { value: string | null; onSave: (v: string | null) => void; 'aria-label'?: string }) {
  const [text, setText] = useState(value ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const focused = useRef(false);
  const saved = useRef(value ?? '');
  useEffect(() => {
    if (!focused.current) { setText(value ?? ''); saved.current = value ?? ''; }
  }, [value]);
  const commit = (v: string, leaving: boolean) => {
    if (v === saved.current) { setProblem(null); return; }
    if (v === '') { if (leaving) { saved.current = ''; setProblem(null); onSave(null); } return; }
    if (plausibleDate(v)) { saved.current = v; setProblem(null); onSave(v); return; }
    if (leaving) setProblem('Check the year: a date from 2000 to 2100.');
  };
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <input {...rest} type="date" value={text} min="2000-01-01" max="2100-12-31"
        onFocus={() => { focused.current = true; }}
        onChange={(e) => { setText(e.target.value); commit(e.target.value, false); }}
        onBlur={(e) => { focused.current = false; commit(e.target.value, true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value, true); }} />
      {problem && <span className="hint" style={{ color: 'var(--late)' }}>{problem}</span>}
    </span>
  );
}
