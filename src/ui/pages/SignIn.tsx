import { useState } from 'react';
import { post, message } from '../lib/api.ts';
import type { Account, Department } from '../lib/types.ts';

export function SignIn({ onSignedIn }: { onSignedIn: (a: Account, d: Department[]) => void }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="signin">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await post<{ account: Account; departments: Department[] }>('/session', { id, password });
          onSignedIn(r.account, r.departments);
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}>
        <span className="brand">
          <span className="brand-mark"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          SnapQuote
        </span>
        <p className="muted">Quotes for Mack Molding, from RFQ to order.</p>
        <label className="field">Username<input autoFocus autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="banner error">{error}</div>}
        <button className="btn primary big" disabled={busy || !id || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="hint">No account, or forgot your password? Ask a SnapQuote administrator.</p>
      </form>
    </div>
  );
}

export function ChangePassword({ forced, onDone }: { forced?: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const form = (
    <form className={forced ? '' : 'card pad stack'} style={forced ? undefined : { maxWidth: 420 }} onSubmit={async (e) => {
      e.preventDefault();
      if (next !== again) { setError('The two new passwords are different.'); return; }
      try {
        await post('/session/password', { currentPassword: current, newPassword: next });
        onDone();
      } catch (err) {
        setError(message(err));
      }
    }}>
      <h2>{forced ? 'Choose your own password' : 'Change your password'}</h2>
      {forced && <p className="muted">The password you were given is temporary.</p>}
      <label className="field">Current password<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label className="field">New password (at least 8 characters)<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="field">New password again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      {error && <div className="banner error">{error}</div>}
      <button className="btn primary" disabled={!current || next.length < 8}>Save password</button>
    </form>
  );
  return forced ? <div className="signin">{form}</div> : <div className="page narrow">{form}</div>;
}
