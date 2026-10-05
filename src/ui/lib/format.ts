export const usd = (n: number | null | undefined, digits?: number): string => {
  if (n === null || n === undefined) return '—';
  const d = digits ?? (Math.abs(n) < 10 && n % 1 !== 0 ? 4 : 2);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Math.min(2, d), maximumFractionDigits: d });
};
export const usdShort = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e4) return `$${Math.round(n / 1e3)}k`;
  return usd(n, 0);
};
export const qty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const DAY = 86_400_000;
const localToday = (): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const parseDay = (iso: string): Date => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y as number, (m as number) - 1, d); };

/** Whole days from today to an ISO date: negative when past. */
export const daysUntil = (iso: string): number => Math.round((parseDay(iso).getTime() - localToday().getTime()) / DAY);

export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = parseDay(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};

/** "due today", "due in 3 days", "2 days late". */
export const dueWords = (iso: string): string => {
  const n = daysUntil(iso);
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  if (n > 1) return n <= 14 ? `due in ${n} days` : `due ${shortDate(iso)}`;
  return n === -1 ? '1 day late' : `${-n} days late`;
};
export const dueTone = (iso: string | null): 'late' | 'soon' | 'ok' => {
  if (!iso) return 'ok';
  const n = daysUntil(iso);
  return n < 0 ? 'late' : n <= 2 ? 'soon' : 'ok';
};

export const ago = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const fileSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
