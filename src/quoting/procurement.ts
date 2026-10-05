// A purchased part's price from a vendor's quote. Pure.
//
// The arithmetic is the old SnapQuote's (ProcuredPartsBOM.tsx): scrap grosses the cost up
// (cost ÷ (1 − scrap)), then freight and markup are added on top, each as a percentage. A vendor's price
// at a quantity is the price of its highest break at or below that quantity; below its lowest break
// there is no price, and the estimator is told rather than given the lowest break's price.

export interface VendorBreak { quantity: number; unitCost: number }
export interface Rates { scrapPct: number; freightPct: number; markupPct: number }

export interface VendorPrice {
  quantity: number;
  /** The vendor's unit cost used, or null below its lowest break. */
  unitCost: number | null;
  breakUsed: number | null;
  unitPrice: number | null;
  warning: string | null;
}

export function rateProblem(r: Rates): string | null {
  for (const [name, v] of [['Scrap', r.scrapPct], ['Freight', r.freightPct], ['Markup', r.markupPct]] as const) {
    if (!Number.isFinite(v) || v < 0) return `${name} must be zero or more.`;
  }
  if (r.scrapPct >= 100) return 'Scrap must be less than 100%.';
  return null;
}

export function applyRates(cost: number, r: Rates): number {
  const afterScrap = r.scrapPct > 0 ? cost / (1 - r.scrapPct / 100) : cost;
  const afterFreight = afterScrap * (1 + r.freightPct / 100);
  return Math.round(afterFreight * (1 + r.markupPct / 100) * 10000) / 10000;
}

export function vendorPrices(breaks: readonly VendorBreak[], quantities: readonly number[], rates: Rates, moq: number | null): VendorPrice[] {
  const sorted = [...breaks].sort((a, b) => a.quantity - b.quantity);
  return quantities.map((quantity) => {
    const b = [...sorted].reverse().find((x) => x.quantity <= quantity) ?? null;
    if (!b) {
      const lowest = sorted[0];
      return { quantity, unitCost: null, breakUsed: null, unitPrice: null, warning: lowest ? `Below the vendor's lowest quantity (${lowest.quantity}).` : 'The vendor gave no prices.' };
    }
    const warning = moq !== null && quantity < moq ? `Below the vendor's minimum order (${moq}).` : null;
    return { quantity, unitCost: b.unitCost, breakUsed: b.quantity, unitPrice: applyRates(b.unitCost, rates), warning };
  });
}
