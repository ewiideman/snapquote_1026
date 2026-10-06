import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { get, post, SIGNED_OUT_EVENT } from './lib/api.ts';
import { useRoute } from './lib/router.ts';
import type { Account, BoardCard, Department, QueueItem } from './lib/types.ts';
import { AppContext, canSell, Toast, type AppState } from './components/ui.tsx';
import { SignIn, ChangePassword, AccountPage } from './pages/SignIn.tsx';
import { Board, DeletedQuotes } from './pages/Board.tsx';
import { Queue } from './pages/Queue.tsx';
import { QuotePage } from './pages/Quote.tsx';
import { SendPage } from './pages/Send.tsx';
import { Settings } from './pages/Settings.tsx';
import { WorkCells } from './pages/WorkCells.tsx';

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      SnapQuote
    </span>
  );
}

function App() {
  const [session, setSession] = useState<{ account: Account | null; departments: Department[] } | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void }; key: number } | null>(null);
  const [counts, setCounts] = useState<{ attention: number; queue: number }>({ attention: 0, queue: 0 });
  const route = useRoute();

  const load = useCallback(() => {
    get<{ account: Account | null; departments: Department[] }>('/session').then(setSession, () => setSession({ account: null, departments: [] }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const on = () => setSession((s) => ({ account: null, departments: s?.departments ?? [] }));
    window.addEventListener(SIGNED_OUT_EVENT, on);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, on);
  }, []);

  const account = session?.account ?? null;
  const refreshCounts = useCallback(() => {
    if (!account || account.mustChangePassword) return;
    if (account.role === 'estimator' && account.department) {
      get<QueueItem[]>(`/queue/${account.department}`).then((q) => setCounts({ attention: 0, queue: q.filter((x) => x.status === 'open').length }), () => undefined);
    } else {
      get<BoardCard[]>('/board').then((b) => setCounts({
        attention: b.filter((c) => (c.ownerId === account.id || account.role !== 'sales') && (c.stage === 'ready' || c.questionsFrom.length > 0)).length, queue: 0,
      }), () => undefined);
    }
  }, [account]);
  useEffect(() => {
    refreshCounts();
    const t = setInterval(refreshCounts, 60_000);
    return () => clearInterval(t);
  }, [refreshCounts, route.path]);

  if (!session) return null;
  if (!account) return <SignIn onSignedIn={(a, d) => setSession({ account: a, departments: d })} />;
  if (account.mustChangePassword) return <ChangePassword forced onDone={load} />;

  const state: AppState = {
    account,
    departments: session.departments,
    deptName: (k) => session.departments.find((d) => d.key === k)?.name ?? (k ?? ''),
    toast: (text, action) => setToast({ text, ...(action ? { action } : {}), key: Date.now() }),
    refreshCounts,
  };
  const seller = canSell(account);
  const path = route.path;
  const quoteMatch = /^\/quotes\/(\d+)(\/send)?$/.exec(path);
  let page;
  if (quoteMatch) page = quoteMatch[2] ? <SendPage id={Number(quoteMatch[1])} /> : <QuotePage id={Number(quoteMatch[1])} />;
  else if (path === '/queue' || (path === '/' && !seller)) page = <Queue department={route.query.get('department')} />;
  else if (path === '/settings') page = <Settings />;
  else if (path === '/deleted') page = <DeletedQuotes />;
  else if (path === '/work-cells') page = <WorkCells />;
  else if (path === '/account') page = <AccountPage account={account} onChanged={(a, said) => { setSession({ account: a, departments: session.departments }); state.toast(said); }} />;
  else page = <Board />;

  const on = (p: string) => (p === '/' ? (path === '/' || path === '/board') : path.startsWith(p)) ? 'on' : '';
  return (
    <AppContext.Provider value={state}>
      <div className="topbar">
        <a href="#/" style={{ textDecoration: 'none' }}><Brand /></a>
        <nav className="nav">
          {seller ? <a className={on('/')} href="#/">Quotes{counts.attention > 0 && <span className="count" title="Ready to send or waiting on an answer">{counts.attention}</span>}</a>
            : <a className={on('/') || on('/queue')} href="#/queue">My queue{counts.queue > 0 && <span className="count">{counts.queue}</span>}</a>}
          {seller && account.role !== 'sales' && <a className={on('/queue')} href="#/queue">Department queues</a>}
          {!seller && <a className={on('/board')} href="#/board">All quotes</a>}
          {((account.role === 'estimator' && account.department === 'metals') || account.role === 'manager' || account.role === 'administrator') && <a className={on('/work-cells')} href="#/work-cells">Work cells</a>}
          {account.role === 'administrator' && <a className={on('/settings')} href="#/settings">Settings</a>}
        </nav>
        <div className="who">
          <a href="#/account" style={{ color: 'inherit' }}><b>{account.displayName}</b></a>
          <button onClick={() => post('/session/sign-out').then(() => setSession({ account: null, departments: session.departments }))}>Sign out</button>
        </div>
      </div>
      {page}
      {toast && <Toast key={toast.key} text={toast.text} {...(toast.action ? { action: toast.action } : {})} onDone={() => setToast(null)} />}
    </AppContext.Provider>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);
