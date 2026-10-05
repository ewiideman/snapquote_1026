// The Production Scheduler's capacity, as SnapQuote shows it. Mirrors src/quoting/exchange.ts.
export interface FacilityCapacity { code: string; name: string; hoursPerWeek: number; lateHours: number; nextSixWeeksHours: number; load: number | null; caughtUpWeek: number | null }
export interface CapacityFile { writtenAt: string; horizonWeeks: number; basis: string; departments: { key: string; label: string; asOf: string; scheduleName: string; facilities: FacilityCapacity[] }[] }
export type CapacityRead = { connected: false } | { connected: true; file: CapacityFile | null; problem: string | null; readAt: string };
export interface WorkCellCapacity { facilities: FacilityCapacity[]; unknown: string[]; hoursPerWeek: number; lateHours: number; nextSixWeeksHours: number; load: number | null; caughtUpWeek: number | null }
export interface Mapping { workCell: string; facilities: string[]; setByName: string; setAt: string }

export function metalsFacilities(read: CapacityRead | undefined | null): FacilityCapacity[] {
  return read && read.connected && read.file ? read.file.departments.filter((d) => d.key === 'metals').flatMap((d) => d.facilities) : [];
}

export function workCellCapacity(read: CapacityRead | undefined | null, codes: readonly string[]): WorkCellCapacity | null {
  const all = metalsFacilities(read);
  if (!all.length || !codes.length) return null;
  const facilities = codes.map((c) => all.find((f) => f.code === c)).filter((f): f is FacilityCapacity => !!f);
  const sum = (k: 'hoursPerWeek' | 'lateHours' | 'nextSixWeeksHours') => Math.round(facilities.reduce((s, f) => s + f[k], 0) * 100) / 100;
  const hoursPerWeek = sum('hoursPerWeek');
  const weeks = facilities.map((f) => f.caughtUpWeek);
  return {
    facilities, unknown: codes.filter((c) => !all.some((f) => f.code === c)), hoursPerWeek, lateHours: sum('lateHours'), nextSixWeeksHours: sum('nextSixWeeksHours'),
    load: hoursPerWeek > 0 ? (sum('lateHours') + sum('nextSixWeeksHours')) / (hoursPerWeek * 6) : null,
    caughtUpWeek: facilities.length === 0 || weeks.some((w) => w === null) ? null : Math.max(...(weeks as number[])),
  };
}

export const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

/** "caught up this week", "late work done by week 4", "not caught up within 12 weeks". */
export function caughtUpWords(c: WorkCellCapacity, horizon: number): string {
  if (c.hoursPerWeek <= 0) return 'no hours in the schedule';
  if (c.caughtUpWeek === 0) return 'nothing late';
  if (c.caughtUpWeek === null) return `not caught up within ${horizon} weeks`;
  return c.caughtUpWeek === 1 ? 'caught up this week' : `caught up in week ${c.caughtUpWeek}`;
}

export const loadTone = (load: number | null): 'late' | 'soon' | 'ok' => (load === null ? 'ok' : load > 1 ? 'late' : load > 0.85 ? 'soon' : 'ok');
