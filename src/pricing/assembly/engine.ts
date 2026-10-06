// The Assembly calculator: what the old SnapQuote's Assembly screen sent to business development
// (AssemblyDashboard.tsx computeAssemblyPolicyUnitCosts at 5920baa, over assemblyLaborCalculations.ts
// computeAssemblyWorkbookModel and assemblyLaborCost.ts). Pure.
//
// The price is labor only, the same at every quantity: every step's assembly, test and QA seconds,
// times how many of that section go into one assembly, in hours rounded to 2 decimals, times the labor
// rate, rounded to the cent. Equipment and tooling on the sections (Mack cost plus NRE) are the
// one-time charge. The old screen also had material, scrap and markup fields, but nothing could enter
// them; they are not carried over.

export interface AssemblyStep { label: string; assemblySec: number | null; testSec: number | null; qaSec: number | null }
export interface AssemblyEquipment { label: string; cost: number | null; nre: number | null }
export interface AssemblySection { name: string; partsPerAssembly: number | null; steps: AssemblyStep[]; equipment: AssemblyEquipment[] }
export interface AssemblyInput { laborRatePerHour: number | null; sections: AssemblySection[] }
export interface AssemblySettings { laborRatePerHour: number }

export const ASSEMBLY_DEFAULTS: AssemblySettings = { laborRatePerHour: 72 };

export interface AssemblyResult {
  sections: { name: string; partsPerAssembly: number; assemblySec: number; testSec: number; qaSec: number; equipment: number }[];
  assemblySec: number; testSec: number; qaSec: number;
  hoursPerAssembly: number;
  laborRatePerHour: number;
  /** The price of one, at every quantity. */
  perUnit: number;
  oneTimeUsd: number;
  warnings: string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** As the workbook reads a column: blanks, non-numbers and negatives are left out. */
const sum = (vs: (number | null | undefined)[]): number => vs.reduce<number>((t, v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? t + v : t), 0);

export function assemblyProblems(input: AssemblyInput): string[] {
  const p: string[] = [];
  const seconds = input.sections.reduce((t, s) => t + sum(s.steps.flatMap((r) => [r.assemblySec, r.testSec, r.qaSec])), 0);
  if (!(seconds > 0)) p.push('Enter the seconds for at least one step.');
  if (input.laborRatePerHour !== null && !(input.laborRatePerHour >= 0)) p.push('The labor rate cannot be negative.');
  return p;
}

export function priceAssembly(input: AssemblyInput, settings: AssemblySettings): AssemblyResult {
  const problems = assemblyProblems(input);
  if (problems.length) throw new Error(problems.join(' '));
  const sections = input.sections.map((s) => {
    const ppa = typeof s.partsPerAssembly === 'number' && Number.isFinite(s.partsPerAssembly) && s.partsPerAssembly > 0 ? s.partsPerAssembly : 1;
    return {
      name: s.name,
      // Rounded to 2 decimals before it multiplies, as the workbook model does (a third becomes 0.33).
      partsPerAssembly: round2(ppa),
      assemblySec: sum(s.steps.map((r) => r.assemblySec)),
      testSec: sum(s.steps.map((r) => r.testSec)),
      qaSec: sum(s.steps.map((r) => r.qaSec)),
      equipment: sum(s.equipment.flatMap((e) => [e.cost, e.nre])),
    };
  });
  const assemblySec = sections.reduce((t, s) => t + s.assemblySec * s.partsPerAssembly, 0);
  const testSec = sections.reduce((t, s) => t + s.testSec * s.partsPerAssembly, 0);
  const qaSec = sections.reduce((t, s) => t + s.qaSec * s.partsPerAssembly, 0);
  const hours = round2((assemblySec + testSec + qaSec) / 3600);
  const rate = input.laborRatePerHour !== null && input.laborRatePerHour >= 0 ? input.laborRatePerHour : settings.laborRatePerHour;
  const warnings: string[] = [];
  if (hours <= 0) {
    // The old screen gave no price at all here and would not let the department send its prices.
    throw new Error(`The steps add up to ${Math.round(assemblySec + testSec + qaSec)} seconds an assembly, which rounds to 0.00 hours: the calculator prices labor in hundredths of an hour (36 seconds). Enter the price by hand.`);
  }
  const exact = (assemblySec + testSec + qaSec) / 3600;
  if (Math.abs(exact - hours) * rate >= 0.005) warnings.push(`Hours are rounded to hundredths as the workbook does: ${exact.toFixed(4)} h is priced as ${hours.toFixed(2)} h.`);
  return {
    sections, assemblySec, testSec, qaSec, hoursPerAssembly: hours, laborRatePerHour: rate,
    perUnit: Math.round(hours * rate * 100) / 100,
    oneTimeUsd: round2(sections.reduce((t, s) => t + s.equipment, 0)),
    warnings,
  };
}
