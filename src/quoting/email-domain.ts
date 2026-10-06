// The company domain of an email address, or null for a personal or shared mail service (and Mack's
// own), which would point every RFQ from it at one customer.
const GENERIC_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'comcast.net', 'mack.com']);

export function emailDomainOf(email: string | null | undefined): string | null {
  const at = email?.trim().toLowerCase().split('@');
  if (!at || at.length !== 2 || !at[0]) return null;
  const d = (at[1] as string).replace(/[>.\s]+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !GENERIC_DOMAINS.has(d) ? d : null;
}
