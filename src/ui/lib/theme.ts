// Light, dark, or the computer's own setting, remembered in this browser. index.html applies the
// saved choice before the first paint, so a dark page never flashes light; this keeps it current.
import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_KEY = 'snapquote.theme';
const CHANGED = 'snapquote-theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Sets data-theme on <html> to what the choice means now. */
export function applyTheme(choice: ThemeChoice): void {
  const theme = choice === 'dark' || (choice === 'system' && systemDark()) ? 'dark' : 'light';
  document.documentElement.dataset['theme'] = theme;
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage unavailable: the choice lasts until the page is closed */
  }
  applyTheme(choice);
  window.dispatchEvent(new Event(CHANGED));
}

/** The current choice, kept in step with the computer's setting, other tabs, and other controls on the page. */
export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    const sync = () => { const c = readTheme(); setChoice(c); applyTheme(c); };
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    window.addEventListener(CHANGED, sync);
    window.addEventListener('storage', sync);
    mq?.addEventListener('change', sync);
    sync();
    return () => { window.removeEventListener(CHANGED, sync); window.removeEventListener('storage', sync); mq?.removeEventListener('change', sync); };
  }, []);
  return [choice, saveTheme];
}
