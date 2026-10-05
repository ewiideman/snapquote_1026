// Outside processing (OSP) cost per part. Ported from SnapQuote 0626 src/utils/metalsOspApi.ts
// (pure parts only). Mack's convention: 20% markup, then 11% freight (METALS_DEFAULTS).

import { METALS_DEFAULTS } from './seed.ts';
import type { MetalsCalculationSettings, MetalsOspInput } from './types.ts';

export type OspRates = { markupPct: number; freightPct: number };

export function ospRatesFromSettings(settings: MetalsCalculationSettings | null | undefined): OspRates {
  return {
    markupPct: settings?.ospMarkupPct ?? METALS_DEFAULTS.ospMarkupPct,
    freightPct: settings?.ospFreightPct ?? METALS_DEFAULTS.ospFreightPct,
  };
}

/**
 * Cost per part one OSP request adds: (unit price + lot charge / request quantity)
 * x (1 + markup) x (1 + freight). A lot charge with no quantity is ignored.
 * 0 until Procurement has priced it; see isOspPending.
 */
export function ospCostPerPart(req: MetalsOspInput, rates: OspRates): number {
  const unit = req.unitPrice ?? 0;
  const lot = req.lotCharge ?? 0;
  const qty = req.quantity !== null && req.quantity > 0 ? req.quantity : 0;
  const base = unit + (qty > 0 ? lot / qty : 0);
  if (!(base > 0)) return 0;
  return base * (1 + rates.markupPct) * (1 + rates.freightPct);
}

/** Raised but not yet priced (draft or sent). */
export function isOspPending(req: MetalsOspInput): boolean {
  return req.status !== 'quoted' && req.status !== 'accepted';
}
