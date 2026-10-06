// The Machining calculator's settings, as the old SnapQuote seeded them (baselinePolicy.js, the
// "corrected baseline": cleaning 10 minutes as the workbook's label says, where its formula used 15).
import type { MachiningSettings } from './types.ts';

export const MACHINING_DEFAULTS: MachiningSettings = {
  operatorLaborRate: 72, processLaborRate: 72, programmingRate: 178,
  rawMaterialMarkup: 0.20, kerfAllowanceIn: 0.08,
  assemblyMarkup: 0.20, assemblyShippingRate: 0.06, outsideOperationMarkup: 0.20, outsideOperationShippingRate: 0.12,
  productiveHoursPerShift: 6.75, workdaysPerWeek: 5,
  partMarkingMinutesPerPart: 0.5, bulkPackMinutesPerBox: 5, separatePackMinutesPerBox: 10, certificateCost: 25,
  deburrCycleMinutes: 15, sandblastCycleMinutes: 5, cleaningCycleMinutes: 10,
  aqlInspectionMinutesPerSample: 5, capStudyMinutesPerUnit: 5, gageRrCostPerStudy: 275,
  difficulty: { A: 0.5, B: 1.0, C: 2.0, D: 4.0 },
  // The workbook's LOOKUP: a lot takes the last band whose figure is at or below it (the source calls
  // these "uppers"; they work as lower bounds), and a lot under the first band takes the first.
  aql: {
    lotFrom: [8, 15, 25, 50, 90, 150, 280, 500, 1200, 3200, 10000, 35000, 150000, 500000],
    levels: {
      'AQL 1.0': [13, 13, 13, 13, 19, 29, 29, 34, 42, 50, 60, 74, 90, 102],
      'AQL 1.5': [8, 8, 8, 13, 19, 19, 21, 27, 35, 38, 46, 56, 64, 64],
      'AQL 2.5': [5, 5, 7, 11, 11, 13, 16, 19, 23, 29, 35, 40, 40, 40],
      'AQL 4.0': [3, 3, 7, 8, 9, 10, 11, 15, 18, 22, 29, 29, 29, 29],
    },
  },
};

export function parseMachiningSettings(raw: unknown): MachiningSettings {
  const o = raw && typeof raw === 'object' ? (raw as Partial<MachiningSettings>) : {};
  return { ...MACHINING_DEFAULTS, ...o, difficulty: { ...MACHINING_DEFAULTS.difficulty, ...(o.difficulty ?? {}) }, aql: o.aql ?? MACHINING_DEFAULTS.aql };
}

export function aqlSampleSize(s: MachiningSettings, level: string, qty: number): number {
  if (level === '100%') return qty;
  const samples = s.aql.levels[level];
  if (level === 'NONE' || !samples) return 0;
  let i = -1;
  s.aql.lotFrom.forEach((from, k) => { if (from <= qty) i = k; });
  return samples[Math.max(i, 0)] ?? 0;
}
