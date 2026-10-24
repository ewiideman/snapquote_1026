import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Account, Department, DepartmentKey, RequestStatus } from '../lib/types.ts';
import { dueTone, dueWords } from '../lib/format.ts';
import { message } from '../lib/api.ts';
import { useTheme, type ThemeChoice } from '../lib/theme.ts';

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
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" />,
  monitor: <><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></>,
  filter: <path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8z" />,
};
export type IconName = keyof typeof ICONS;
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/**
 * The "SQ" mark: SnapQuote V2's logo drawn as a vector, so it is sharp at any size. It takes its color
 * from the brand-logo class.
 */
export function BrandMark({ className = 'brand-logo' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 41 25" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={5} strokeLinejoin="round">
      <path d="M15.2 6.6C14.3 4.4 12.4 3.2 9.9 3.2 6.9 3.2 4.6 4.9 4.6 7.4c0 5.6 11 3.6 11 9.9 0 2.7-2.5 4.6-5.8 4.6-2.8 0-5-1.3-6.1-3.6" />
      <circle cx="29.2" cy="12.5" r="8.3" />
      <path d="M32.3 17.8l5.3 5.2" />
    </svg>
  );
}

const THEMES: { key: ThemeChoice; label: string; icon: IconName }[] = [
  { key: 'system', label: 'System', icon: 'monitor' },
  { key: 'light', label: 'Light', icon: 'sun' },
  { key: 'dark', label: 'Dark', icon: 'moon' },
];

/**
 * Light, dark, or the computer's setting: a button that opens the three choices. The sidebar has one
 * beside the brand and one in its foot, for the icon rail; the stylesheet shows the one that fits.
 */
export function ThemeMenu({ where }: { where: 'top' | 'foot' }) {
  const [choice, setChoice] = useTheme();
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector<HTMLButtonElement>('.icon-btn')?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const now = THEMES.find((t) => t.key === choice) ?? THEMES[0]!;
  return (
    <div className={`theme ${where}`} ref={box}>
      <button type="button" className="icon-btn" aria-expanded={open} aria-controls={id} title={`Theme: ${now.key === 'system' ? 'same as this computer' : now.label}`} data-tip="Theme" onClick={() => setOpen(!open)}>
        <Icon name={now.icon} /><span className="sr">Theme: {now.label}</span>
      </button>
      {open && (
        <div className="popover theme-choices" id={id} role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button type="button" key={t.key} aria-pressed={choice === t.key} onClick={() => { setChoice(t.key); setOpen(false); }}>
              <Icon name={t.icon} /><span className="grow">{t.label}</span>{choice === t.key && <Icon name="check" className="tick" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The same three choices as a segmented control, for the account page. */
export function ThemeChoices() {
  const [choice, setChoice] = useTheme();
  return (
    <div className="seg" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button type="button" key={t.key} className={choice === t.key ? 'on' : ''} aria-pressed={choice === t.key} onClick={() => setChoice(t.key)}>
          <Icon name={t.icon} />{t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One line of text that wraps and grows to show itself whole, such as a part's description in a table.
 * Enter finishes, as in a one-line field.
 */
export function GrowingText({ value, onChange, onBlur, className = 'bare', placeholder, ...rest }: { value: string; onChange: (v: string) => void; onBlur?: () => void; className?: string; placeholder?: string; 'aria-label'?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } };
  useEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.offsetWidth;
    const ro = new ResizeObserver(() => { if (el.offsetWidth !== w) { w = el.offsetWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea ref={ref} className={className} rows={1} value={value} placeholder={placeholder} aria-label={rest['aria-label']}
      onChange={(e) => onChange(e.target.value.replace(/\n+/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      onBlur={onBlur} />
  );
}

/**
 * A text field with suggestions as you type, drawn by SnapQuote rather than the browser (Safari draws
 * its own list in the computer's colors, not the page's, and it came out white on white). Typing
 * anything else is allowed. Arrow keys move through the list, Enter takes one, Escape closes it.
 * `onCommit` runs when the field is left, as a plain field's blur would.
 */
export function SuggestInput({ value, defaultValue, onChange, onCommit, options, placeholder, autoFocus, ...rest }: {
  value?: string; defaultValue?: string; onChange?: (v: string) => void; onCommit?: (v: string) => void; options: readonly string[];
  placeholder?: string; autoFocus?: boolean; 'aria-label'?: string;
}) {
  const [text, setText] = useState(value ?? defaultValue ?? '');
  useEffect(() => { if (value !== undefined) setText(value); }, [value]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const q = text.trim().toLowerCase();
  const matches = options.filter((o) => !q || o.toLowerCase().includes(q)).slice(0, 8);
  const shown = open && matches.length > 0 && !(matches.length === 1 && matches[0] === text);
  const set = (v: string) => { setText(v); onChange?.(v); };
  const pick = (v: string) => { set(v); setOpen(false); setActive(-1); };
  return (
    <div className="suggest">
      <input value={text} placeholder={placeholder} autoFocus={autoFocus} aria-label={rest['aria-label']} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={id} aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        onChange={(e) => { set(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); onCommit?.(text); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && shown && active >= 0 && matches[active] !== undefined) { e.preventDefault(); pick(matches[active] as string); }
          else if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }} />
      {shown && (
        <ul className="popover suggest-list" id={id} role="listbox">
          {matches.map((o, i) => (
            <li key={o} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>{o}</li>
          ))}
        </ul>
      )}
    </div>
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
      {busy && <div className="busy" role="status"><Icon name="upload" />{busy}</div>}
    </div>
  );
}

/**
 * The intake strip: a compact drop target with its own Upload button. Files may be dropped anywhere on
 * it, several at once or one at a time; any type is taken. Children (help, files waiting) sit inside it,
 * so dropping on them works too.
 */
export function DropStrip({ onFiles, title, hint, busy, accept, actions, children, error }: { onFiles: (files: File[]) => void; title: ReactNode; hint: ReactNode; busy?: string | null; accept?: string; actions?: ReactNode; children?: ReactNode; error?: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop strip${over ? ' over' : ''}${error ? ' failed' : ''}`}
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
      {error && <div className="strip-error" role="alert"><Icon name="alert" /><span>{error}</span></div>}
      {children}
      <input ref={input} type="file" multiple accept={accept} tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
      {over && <div className="drop-hint" aria-hidden="true"><Icon name="upload" />Drop to add to the new quote</div>}
      {busy && <div className="busy" role="status"><Icon name="upload" />{busy}</div>}
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

export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
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
