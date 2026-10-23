// When reminders go out: the working day before the date due (Eric Wiideman, Oct 22, 2026: "day
// before due"). A Monday date is reminded of on the Friday before, since nobody reads Sunday's email.
// Holidays are not known here. Pure; dates are YYYY-MM-DD in the server's local time.

/** The hour of the reminder day from which reminders are sent, so they arrive with the workday, not at midnight. */
export const REMINDER_HOUR = 7;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, d, 12); };

/** Today in the server's local time. */
export const localDate = (now: Date): string => iso(now);

/** The working day before `due`: the day before, or the Friday before a Saturday, Sunday or Monday. */
export function reminderDay(due: string): string {
  const d = parse(due);
  do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6);
  return iso(d);
}

/** The dates due that are reminded of on `today`: tomorrow, and on a Friday the weekend and Monday too. */
export function datesRemindedOn(today: string): string[] {
  const out: string[] = [];
  const d = parse(today);
  for (let i = 1; i <= 3; i++) {
    d.setDate(d.getDate() + 1);
    if (reminderDay(iso(d)) === today) out.push(iso(d));
  }
  return out;
}
