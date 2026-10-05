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
export const canEstimate = (a: Account, dept: string | null) => !!dept && ((a.role === 'estimator' && a.department === dept) || a.role === 'manager' || a.role === 'administrator');

// ---------------------------------------------------------------- small pieces

export function Icon({ name }: { name: 'upload' | 'check' | 'mail' | 'plus' | 'file' | 'arrow' }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === 'upload' && <><path {...p} d="M12 16V4" /><path {...p} d="M7 9l5-5 5 5" /><path {...p} d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>}
      {name === 'check' && <path {...p} d="M5 12.5l4.5 4.5L19 7" />}
      {name === 'mail' && <><rect {...p} x="3" y="5" width="18" height="14" rx="2" /><path {...p} d="M3 7l9 6 9-6" /></>}
      {name === 'plus' && <path {...p} d="M12 5v14M5 12h14" />}
      {name === 'file' && <><path {...p} d="M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7z" /><path {...p} d="M14 3v4h4" /></>}
      {name === 'arrow' && <path {...p} d="M5 12h14M13 6l6 6-6 6" />}
    </svg>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="banner error" role="alert">{message(error)}</div>;
}

export function Due({ date, prefix }: { date: string | null; prefix?: string }) {
  if (!date) return null;
  const tone = dueTone(date);
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
