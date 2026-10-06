// The Molding (ADC) calculator: ADC's "Tool Development Form" model, ported from the old SnapQuote's
// src/utils/calc.ts (5920baa) formula for formula, with its rounding. Only the rates moved: they
// are settings now, defaulting to the old hard-coded values (settings.ts). Pure.
//
// The price is per piece and the same at every quantity: material + press time + setup, with setup
// spread over the year's volume (EAU), not over the quantity quoted. The mold is a separate one-time
// charge. No markup, overhead or labor is added -- the old calculator added none; business
// development sets its own price on the quote.
import { rungFor } from './settings.ts';
import type { MoldingInput, MoldingPress, MoldingResin, MoldingResult, MoldingSettings } from './types.ts';

const BARREL_MIN_FACTOR = 0.04458823;
const BARREL_MAX_FACTOR = 0.25266666;
const RESIN_REF_DENSITY = 0.0379; // polystyrene: a barrel's capacity is stated in styrene ounces
const RESIN_USAGE_MULTIPLIER = 1.15;

const round = (n: number, decimals: number): number => { const p = 10 ** decimals; return Math.round(n * p) / p; };
const n0 = (v: number | null | undefined): number => (v === null || v === undefined || !Number.isFinite(v) ? 0 : v);

export function runnerDiameterIn(wallThicknessIn: number): number {
  if (wallThicknessIn <= 0.12) return 0.18;
  if (wallThicknessIn <= 0.19) return 0.24;
  if (wallThicknessIn < 0.25) return 0.32;
  return 0.37;
}

/** What must be filled in before there is a price. */
export function moldingProblems(input: MoldingInput, resins: MoldingResin[], presses: MoldingPress[]): string[] {
  const p: string[] = [];
  const resin = resins.find((r) => r.name === input.resin);
  if (!input.resin) p.push('Choose a resin.');
  else if (!resin) p.push(`Resin "${input.resin}" is not in the resin list.`);
  else if (!(resin.pricePerLb > 0)) p.push(`${resin.name} has no price per pound. An administrator sets it under Settings.`);
  if (input.pressId && !presses.some((x) => x.id === input.pressId)) p.push(`Press "${input.pressId}" is not in the press list.`);
  if (!presses.length) p.push('The press list is empty.');
  for (const [v, what] of [[input.eau, 'Annual volume (EAU)'], [input.cavitation, 'Cavities'], [input.cycleTimeSec, 'Cycle time'], [input.partVolumeIn3, 'Part volume']] as const) {
    if (!(n0(v) > 0)) p.push(`${what} is needed.`);
  }
  if (input.cavitation !== null && !Number.isInteger(input.cavitation)) p.push('Cavities must be a whole number.');
  return p;
}

/** The smallest press with the tonnage whose shot-to-barrel is inside the resin's range; else the smallest with the tonnage; else the largest. */
export function selectPress(input: MoldingInput, resin: MoldingResin, presses: MoldingPress[]): MoldingPress | null {
  if (!presses.length) return null;
  const minTon = 1.1 * n0(input.cavitation) * n0(input.moldingPressure) * n0(input.footprintIn2);
  const shot = shotWeightOz(input, resin).shot;
  const lo = Math.min(resin.barrelMinPct, resin.barrelMaxPct);
  const hi = Math.max(resin.barrelMinPct, resin.barrelMaxPct);
  const sorted = [...presses].sort((a, b) => a.tons - b.tons);
  return sorted.find((p) => p.tons >= minTon && inRange(shotToBarrelPct(shot, p, resin), lo, hi))
    ?? sorted.find((p) => p.tons >= minTon)
    ?? sorted[sorted.length - 1] ?? null;
}
const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

function shotWeightOz(input: MoldingInput, resin: MoldingResin): { part: number; runner: number; shot: number } {
  const part = round(n0(input.partVolumeIn3) * resin.densityLbPerIn3 * 16, 2);
  const radius = runnerDiameterIn(n0(input.wallThicknessIn)) / 2;
  // The runner is one runner for the shot, not one per cavity -- as the form computes it.
  const runner = round(Math.PI * radius * radius * n0(input.runnerLengthIn) * resin.densityLbPerIn3 * 16, 2);
  return { part, runner, shot: round(part * n0(input.cavitation) + runner, 2) };
}

function shotToBarrelPct(shotOz: number, press: MoldingPress, resin: MoldingResin): number {
  const denom = press.barrelOz * (resin.densityLbPerIn3 / RESIN_REF_DENSITY);
  return denom ? Math.floor((shotOz / denom) * 100) : 0;
}

export function priceMolding(input: MoldingInput, settings: MoldingSettings, resins: MoldingResin[], presses: MoldingPress[]): MoldingResult {
  const problems = moldingProblems(input, resins, presses);
  if (problems.length) throw new Error(problems.join(' '));
  const resin = resins.find((r) => r.name === input.resin) as MoldingResin;
  const chosen = input.pressId ? presses.find((p) => p.id === input.pressId) ?? null : selectPress(input, resin, presses);
  if (!chosen) throw new Error('No press.');
  const warnings: string[] = [];
  const cav = n0(input.cavitation);
  const cycle = n0(input.cycleTimeSec);
  const eau = n0(input.eau);

  const { part, runner, shot } = shotWeightOz(input, resin);
  // Material: the whole shot, runner included, shared by the cavities; × 1.2 ÷ 0.95 as the form has it.
  const material = round((resin.pricePerLb * ((shot / 16) / cav) * (1 + settings.materialAdder)) / (1 - settings.materialScrap), 2);
  const partsPerHour = (3600 / cycle) * cav * (1 - settings.moldingScrap);
  const rate = rungFor(settings.pressRate, chosen.tons);
  const molding = Number((rate.usd / partsPerHour).toFixed(4));
  const setupRung = rungFor(settings.setupCost, chosen.tons);
  if (!setupRung.matched) {
    warnings.push(`ADC's setup table has no row for a ${chosen.tons}-ton press, so setup is $${setupRung.usd} a setup, as the old calculator took it. Ask ADC what one setup on this press costs.`);
  }
  const setup = (setupRung.usd * settings.setupsPerYear) / eau;
  const perPart = Number((material + molding + setup).toFixed(4));

  const minTonnage = 1.1 * cav * n0(input.moldingPressure) * n0(input.footprintIn2);
  const stb = shotToBarrelPct(shot, chosen, resin);
  const lo = Math.min(resin.barrelMinPct, resin.barrelMaxPct);
  const hi = Math.max(resin.barrelMinPct, resin.barrelMaxPct);
  if (minTonnage > chosen.tons) warnings.push(`The part needs about ${Math.ceil(minTonnage)} tons; ${chosen.id} is ${chosen.tons}.`);
  if (!inRange(stb, lo, hi)) warnings.push(`The shot is ${stb}% of ${chosen.id}'s barrel; ${resin.name} runs best between ${lo}% and ${hi}%.`);
  const pressDays = Math.ceil(((eau / cav) * cycle) / 86400);
  const dryer = Math.round((3600 / cycle) * (shot / 16));

  // ---- the mold
  const t = input.tool;
  const steel = settings.steel[t.steelType];
  if (!steel) warnings.push(`No steel rate for "${t.steelType}", so the computed mold price is $0.`);
  const L = n0(input.partLengthIn), W = n0(input.partWidthIn), H = n0(input.partHeightIn);
  // As the form has it: across several cavities the length grows with them and the width does not.
  const toolLen = cav === 1 ? cav * L + 10 : cav * L + 7;
  const toolWid = cav === 1 ? cav * W + 10 : W + 7;
  const toolHei = H > 5 ? H * 2 : 10;
  const weightLb = toolLen * toolWid * toolHei * (steel?.densityLbPerIn3 ?? 0);
  const gates = n0(t.gatesCount);
  const moldTypeFactor = t.moldType === '2 Plate' ? 1.2 : t.moldType === '3 Plate' ? 2.2 : t.moldType === 'MUD' ? 0.5 : 1.0;
  const sideActions = cav * n0(t.sideActionQty) * 2000;
  const gateCost = t.gateType === 'Hot Tip' || t.gateType === 'Hot Edge' ? gates * cav * 5000 : t.gateType === 'Valve Gates' ? gates * cav * 9000 : 0;
  const runnerSystem = t.runnerType === 'Cold Runner' ? gates * cav * 3000 : t.runnerType === 'Hot to Cold' ? gates * cav * 4000 : t.runnerType === 'Hot Runner' ? gates * cav * 1000 : 0;
  if (t.runnerType === 'Inserted Hot Runner') warnings.push('The form prices an inserted hot runner at $0; the mold price leaves it out.');
  const c = n0(t.complexity);
  const complexityFactor = c === 1 || c === 2 ? 1.65 : c === 3 ? 1.85 : c === 4 || c === 5 ? 2.65 : 1.0;
  const computed = (weightLb * (steel?.usdPerLb ?? 0) * moldTypeFactor + sideActions + gateCost + runnerSystem) * (t.ejectionSide === 'Reverse' ? 1.15 : 1.0) * complexityFactor;
  const given = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
  const domestic = given(t.domesticUsd) ?? computed;
  const china = given(t.chinaUsd) ?? computed * settings.chinaFactor;
  const portugal = given(t.portugalUsd) ?? computed * settings.portugalFactor;
  const oneTime = input.tooling === 'domestic' ? domestic : input.tooling === 'china' ? china : input.tooling === 'portugal' ? portugal : 0;
  const label = input.tooling === 'none' ? '' : `Mold (${input.tooling === 'domestic' ? 'domestic' : input.tooling === 'china' ? 'China' : 'Portugal'})`;

  return {
    press: { id: chosen.id, tons: chosen.tons, chosen: input.pressId ? 'by_estimator' : 'smallest_that_fits' },
    partWeightOz: part, runnerWeightOz: runner, shotWeightOz: shot,
    materialPerPart: material, moldingPerPart: molding, setupPerPart: setup, perPart,
    process: {
      minTonnage, shotToBarrelPct: stb,
      minBarrelOz: Math.round((BARREL_MIN_FACTOR * shot) / resin.densityLbPerIn3),
      maxBarrelOz: Math.round((BARREL_MAX_FACTOR * shot) / resin.densityLbPerIn3),
      flowRatio: n0(input.wallThicknessIn) ? Number((n0(input.flowLengthIn) / n0(input.wallThicknessIn)).toFixed(0)) : 0,
      pressDaysPerYear: pressDays,
      pressUtilizationPct: round((pressDays / settings.workingDaysPerYear) * 100, 2),
      resinLbPerYear: round(eau * (shot / 16) * RESIN_USAGE_MULTIPLIER, 1),
      dryerLbPerHour: dryer,
      hopperLb: Math.floor(dryer / 24),
      partsPerHour,
    },
    tool: { weightLb, domestic, china, portugal, chosen: input.tooling, oneTimeUsd: Math.round(oneTime * 100) / 100, oneTimeLabel: label },
    warnings,
  };
}
