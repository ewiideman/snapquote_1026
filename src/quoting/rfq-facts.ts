// What an RFQ email says plainly about the quote: who the customer is, the quantities, and when the
// quote is due. Read only where the customer wrote it, never guessed: the company is a line of its own
// (a signature, a letterhead) that names the sender's own email domain; quantities and the due date
// are lines the customer labeled ("Quantities: ...", "Quote due: ..."). Pure.
import { emailDomainOf } from './email-domain.ts';

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const SUFFIX = /\b(inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|limited|lp|llp|plc|gmbh|ag|sa|bv|s\.a)\b\.?/i;

/** The domain's own name: "cobaltridge-medical.example" is "cobaltridge" and "cobaltridgemedical". */
function domainNames(domain: string): string[] {
  const label = domain.split('.').filter((p) => !['www', 'mail', 'email'].includes(p))[0] ?? '';
  const parts = label.split('-').filter(Boolean);
  return [...new Set([squash(label), squash(parts[0] ?? '')])].filter((n) => n.length >= 4);
}

/**
 * The customer's company, from a line that is only a company name and begins with the sender's domain
 * name: "Cobalt Ridge Medical Systems, LLC" from marcus@cobaltridge-medical.com. A sentence ("Cobalt
 * Ridge is requesting a quote ...") is not a name. With a company suffix (Inc, LLC) the line wins over
 * one without; then the longer. Nothing from a shared mail service such as Gmail.
 */
export function companyFromEmail(text: string, fromAddress: string | null): string | null {
  const domain = emailDomainOf(fromAddress);
  if (!domain) return null;
  const names = domainNames(domain);
  if (!names.length) return null;
  const found: { name: string; score: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*\((fictional|sample)\)\s*$/i, '').replace(/^[\s>*•-]+/, '').trim();
    if (line.length < 4 || line.length > 70 || /@|https?:|www\./i.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length > 7) continue;
    // A sentence, not a name: it ends in a stop that is not a suffix's, or it has a verb-like comma clause.
    if (/[.!?:;]$/.test(line) && !SUFFIX.test(words[words.length - 1] ?? '')) continue;
    if (!/^[A-Z0-9]/.test(line)) continue;
    const s = squash(line);
    if (!names.some((n) => s.startsWith(n))) continue;
    // Every word of a name is capitalized or a joining word.
    if (!words.every((w) => /^[A-Z0-9&(]/.test(w) || /^(of|and|the|de|for|&)$/i.test(w.replace(/[,.]/g, '')))) continue;
    found.push({ name: line.replace(/[;:]$/, ''), score: (SUFFIX.test(line) ? 100 : 0) + line.length });
  }
  found.sort((a, b) => b.score - a.score);
  return found[0]?.name ?? null;
}

const LABELED = (labels: string) => new RegExp(`^\\s*(?:[-*•]\\s*)?(?:${labels})\\b[^:\\n]{0,40}:\\s*(.+)$`, 'im');

/**
 * The quantities from a line the customer labeled "Quantities:" or "Qty:" (not an annual usage):
 * "Quantities (complete assemblies): 250, 500 and 1,000" is [250, 500, 1000]. Whole numbers above zero,
 * at most 10; "1k" is 1,000. None when the line says something else.
 */
export function quantitiesFromEmail(text: string): number[] | null {
  const m = LABELED('quantities|quantity|qtys?|quote quantities|break quantities|price breaks').exec(text);
  if (!m) return null;
  const head = m[0].slice(0, m[0].indexOf(':'));
  if (/annual|eau|per year|yearly|usage|forecast/i.test(head)) return null;
  const rest = (m[1] ?? '').replace(/\(.*?\)/g, ' ');
  const values = [...rest.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/gi)].map((x) => Number((x[1] ?? '').replace(/,/g, '')) * (x[2] ? 1000 : 1));
  const qs = [...new Set(values)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  return qs.length && qs.length <= 10 ? qs : null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A date as written: "Friday, November 13, 2026", "Nov 13, 2026", "11/13/2026" or "2026-11-13". */
export function readDate(s: string): string | null {
  const iso = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return y >= 2000 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  };
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[1]), Number(m[2]));
  m = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(s);
  if (m) {
    const month = MONTHS.findIndex((x) => x.startsWith((m?.[1] ?? '').toLowerCase()) && (m?.[1] ?? '').length >= 3);
    if (month >= 0) return iso(Number(m[3]), month + 1, Number(m[2]));
  }
  return null;
}

/** When the customer wants the quote, from a line labeled "Quote due:", "Due date:", "Response due:" and the like. */
export function dueDateFromEmail(text: string): string | null {
  const m = LABELED('quotes? (?:is )?due|quotation due|rfq due|response due|responses due|bids? due|due date|due by|please quote by|quote by').exec(text);
  return m ? readDate(m[1] ?? '') : null;
}
