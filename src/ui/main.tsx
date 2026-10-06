import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import './styles.css';
import { get, post, SIGNED_OUT_EVENT } from './lib/api.ts';
import { useRoute } from './lib/router.ts';
import type { Account, BoardCard, Department, QueueItem } from './lib/types.ts';
import { AppContext, canSell, Icon, ROLE_NAMES, Toast, type AppState, type IconName } from './components/ui.tsx';
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
      <span className="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      <span className="brand-name">SnapQuote</span>
    </span>
  );
}

/** One destination in the sidebar. The label stays in the page for screen readers when the rail hides it. */
function NavLink({ href, icon, label, on, count, countTitle }: { href: string; icon: IconName; label: string; on: boolean; count?: number; countTitle?: string }) {
  return (
    <a className={on ? 'on' : ''} href={href} aria-current={on ? 'page' : undefined} data-tip={label}>
      <Icon name={icon} />
      <span className="label">{label}</span>
      {!!count && <span className="count" title={countTitle}>{count}<span className="sr"> {countTitle ?? ''}</span></span>}
    </a>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

function App() {
  const [session, setSession] = useState<{ account: Account | null; departments: Department[] } | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void }; key: number } | null>(null);
  const [counts, setCounts] = useState<{ attention: number; queue: number }>({ attention: 0, queue: 0 });
  const [menu, setMenu] = useState(false);
  const route = useRoute();
  useEffect(() => { setMenu(false); }, [route.path]);
  useEffect(() => {
    if (!menu) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [menu]);

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

  const on = (p: string) => (p === '/' ? (path === '/' || path === '/board') : path.startsWith(p));
  const signOut = () => post('/session/sign-out').then(() => setSession({ account: null, departments: session.departments }));
  const waiting = seller ? counts.attention : counts.queue;
  return (
    <AppContext.Provider value={state}>
      <div className="shell">
        <aside className={`sidebar${menu ? ' open' : ''}`}>
          <div className="side-top">
            <a href="#/" className="brand-link" aria-label="SnapQuote home"><Brand /></a>
            <button type="button" className="icon-btn menu-btn" aria-expanded={menu} aria-controls="side-menu" aria-label={menu ? 'Close the menu' : 'Open the menu'} onClick={() => setMenu(!menu)}>
              <Icon name={menu ? 'close' : 'menu'} />
              {!menu && waiting > 0 && <span className="menu-dot" aria-hidden="true" />}
            </button>
          </div>
          <div className="side-menu" id="side-menu">
            <nav className="sidenav" aria-label="Main">
              {seller
                ? <NavLink href="#/" icon="quotes" label="Quotes" on={on('/')} count={counts.attention} countTitle="ready to send or waiting on an answer" />
                : <NavLink href="#/queue" icon="inbox" label="My queue" on={on('/') || on('/queue')} count={counts.queue} countTitle="waiting on your department" />}
              {seller && account.role !== 'sales' && <NavLink href="#/queue" icon="inbox" label="Department queues" on={on('/queue')} />}
              {!seller && <NavLink href="#/board" icon="board" label="All quotes" on={on('/board')} />}
              {((account.role === 'estimator' && account.department === 'metals') || account.role === 'manager' || account.role === 'administrator') && <NavLink href="#/work-cells" icon="cells" label="Work cells" on={on('/work-cells')} />}
              {account.role === 'administrator' && <NavLink href="#/settings" icon="settings" label="Settings" on={on('/settings')} />}
            </nav>
            <div className="side-foot">
              <a href="#/account" className={`me${on('/account') ? ' on' : ''}`} aria-current={on('/account') ? 'page' : undefined} data-tip={`${account.displayName}: your account`}>
                <span className="avatar" aria-hidden="true">{initials(account.displayName)}</span>
                <span className="label"><b>{account.displayName}</b><small>{account.role === 'estimator' && account.department ? state.deptName(account.department) : ROLE_NAMES[account.role]}</small></span>
              </a>
              <button type="button" className="icon-btn signout" onClick={signOut} title="Sign out" data-tip="Sign out"><Icon name="signout" /><span className="sr">Sign out</span></button>
            </div>
          </div>
        </aside>
        {menu && <div className="side-scrim" onClick={() => setMenu(false)} />}
        <main className="main">{page}</main>
      </div>
      {toast && <Toast key={toast.key} text={toast.text} {...(toast.action ? { action: toast.action } : {})} onDone={() => setToast(null)} />}
    </AppContext.Provider>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);
