// The Molding calculator's rates, as the old SnapQuote hard-coded them (src/utils/calc.ts at 5920baa).
// The ladders are written as the old if-chains were, rung for rung and in the same order, gaps
// included: a tonnage no rung covers takes `otherwise`. Kept exactly so a price here is the price ADC
// got before; the gaps are listed in docs/molding-calculator.md as questions for ADC.
import type { MoldingSettings, TonnageRung } from './types.ts';

export const MOLDING_DEFAULTS: MoldingSettings = {
  pressRate: {
    rungs: [
      { gte: 2300, usd: 482 }, { gte: 1650, usd: 383 }, { gte: 1100, usd: 317 }, { gte: 800, usd: 257 }, { gte: 700, usd: 192 },
      { gte: 500, usd: 152 }, { gte: 350, usd: 142 }, { gte: 165, usd: 128 }, { gte: 100, usd: 112 }, { gte: 40, usd: 94 },
    ],
    otherwise: 94,
  },
  setupCost: {
    rungs: [
      { gte: 2300, usd: 19281 }, { gt: 2099, lt: 2301, usd: 17945 }, { gt: 1899, lt: 2001, usd: 15257 }, { gt: 1699, lt: 1801, usd: 14380 },
      { gt: 1699, lt: 1701, usd: 13403 }, { gt: 1099, lt: 1501, usd: 12690 }, { gt: 799, lt: 1001, usd: 10272 }, { gt: 699, lt: 751, usd: 7597 },
      { gt: 599, lt: 651, usd: 7079 }, { eq: 500, usd: 6694 }, { gt: 399, lt: 451, usd: 6652 }, { gt: 349, lt: 401, usd: 6136 },
      { gt: 299, lt: 351, usd: 5896 }, { gt: 249, lt: 301, usd: 5380 }, { gt: 199, lt: 231, usd: 5127 }, { gt: 99, lt: 151, usd: 4483 },
      { gt: 39, lt: 61, usd: 94 },
    ],
    otherwise: 94,
  },
  setupsPerYear: 4,
  moldingScrap: 0.05,
  materialAdder: 0.2,
  materialScrap: 0.05,
  workingDaysPerYear: 250,
  steel: {
    'P20': { usdPerLb: 23, densityLbPerIn3: 0.284 },
    'P20HH': { usdPerLb: 23, densityLbPerIn3: 0.284 },
    'Hybrid': { usdPerLb: 23, densityLbPerIn3: 0.284 },
    'H13': { usdPerLb: 26.91, densityLbPerIn3: 0.28 },
    '420SS': { usdPerLb: 30, densityLbPerIn3: 0.279 },
    'Aluminum': { usdPerLb: 67.85, densityLbPerIn3: 0.0975 },
  },
  chinaFactor: 0.4,
  portugalFactor: 0.9,
};

export function rungFor(ladder: { rungs: TonnageRung[]; otherwise: number }, tons: number): { usd: number; matched: boolean } {
  for (const r of ladder.rungs) {
    if (r.gt !== undefined && !(tons > r.gt)) continue;
    if (r.gte !== undefined && !(tons >= r.gte)) continue;
    if (r.lt !== undefined && !(tons < r.lt)) continue;
    if (r.eq !== undefined && tons !== r.eq) continue;
    return { usd: r.usd, matched: true };
  }
  return { usd: ladder.otherwise, matched: false };
}

/** An administrator's saved settings over the defaults: any field not saved keeps its default. */
export function parseMoldingSettings(raw: unknown): MoldingSettings {
  const o = raw && typeof raw === 'object' ? (raw as Partial<MoldingSettings>) : {};
  return { ...MOLDING_DEFAULTS, ...o, steel: { ...MOLDING_DEFAULTS.steel, ...(o.steel ?? {}) } };
}
