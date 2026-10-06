// The Machining calculator: the old SnapQuote's "Machined Parts Workbook Baseline"
// (backend-postgres/lib/machined/baselinePolicy.js at 5920baa, from "SNAPQUOTE EXCEL TEMPLATE.xlsx").
// The old app evaluated its 31 formulas as expression strings; here they are written out, in the same
// order and with the same names, so each line of a break can be compared with the old engine's.
// Pure. No rounding anywhere, as in the old engine.
//
// The price per piece at a quantity is every recurring and amortized cost for that quantity divided by
// it, so setup, programming (when amortized) and other lot costs make small quantities dearer.
// Non-amortized programming, workholding, tooling and gaging are the one-time charge (nre_cost).
import { aqlSampleSize } from './settings.ts';
import type { MachiningBreak, MachiningInput, MachiningMachine, MachiningResult, MachiningSettings, MachiningStock } from './types.ts';

const n = (v: number | null | undefined, d = 0): number => (v === null || v === undefined || !Number.isFinite(v) ? d : v);
const b = (v: boolean): number => (v ? 1 : 0);
const atLeastOne = (v: number | null | undefined): number => (n(v) > 0 ? n(v) : 1);

/** What must be filled in before there is a price. */
export function machiningProblems(input: MachiningInput, machines: MachiningMachine[], stock: MachiningStock[]): string[] {
  const p: string[] = [];
  const known = (name: string) => machines.some((m) => m.name === name);
  if (!input.primaryMachine) p.push('Choose the machine.');
  else if (!known(input.primaryMachine)) p.push(`Machine "${input.primaryMachine}" is not in the machine list.`);
  if (!(n(input.primaryCycleSec) > 0)) p.push('Cycle time is needed.');
  // The old engine took a blank duty cycle as 0: the machine running unattended, a full operator's
  // rate taken off. That is a choice, so it is asked for rather than assumed.
  if (input.primaryDutyCycle === null || input.primaryDutyCycle < 0 || input.primaryDutyCycle > 1) p.push('Operator time on the machine (0 to 1) is needed.');
  if (input.secondaryMachine) {
    if (!known(input.secondaryMachine)) p.push(`Machine "${input.secondaryMachine}" is not in the machine list.`);
    if (input.secondaryDutyCycle === null || input.secondaryDutyCycle < 0 || input.secondaryDutyCycle > 1) p.push('Operator time on the second machine (0 to 1) is needed.');
  }
  const m = input.material;
  if (m.mode === 'STOCKED') {
    const s = stock.find((x) => x.partNumber === m.partNumber);
    if (!m.partNumber) p.push('Choose the bar stock, or enter a custom material price.');
    else if (!s) p.push(`Bar stock "${m.partNumber}" is not in the list.`);
    else if (!(s.costPerBar > 0)) p.push(`${s.partNumber} has no cost per bar. An administrator sets it under Settings.`);
    if (!(n(m.rawLengthIn) > 0)) p.push('Length of stock per part is needed.');
  } else if (!(n(m.unitPrice) > 0)) p.push('Custom material price per part is needed.');
  return p;
}

export function priceMachining(input: MachiningInput, quantities: number[], s: MachiningSettings, machines: MachiningMachine[], stock: MachiningStock[]): MachiningResult {
  const problems = machiningProblems(input, machines, stock);
  if (problems.length) throw new Error(problems.join(' '));
  const warnings: string[] = [];
  const rate = (name: string | null) => (name ? machines.find((m) => m.name === name)?.ratePerHour ?? 0 : 0);
  const primaryRate = rate(input.primaryMachine);
  const secondaryRate = rate(input.secondaryMachine);
  const pCycle = n(input.primaryCycleSec), sCycle = input.secondaryMachine ? n(input.secondaryCycleSec) : 0;
  const pDuty = n(input.primaryDutyCycle), sDuty = n(input.secondaryDutyCycle);
  const m = input.material;
  const custom = m.mode === 'CUSTOM';
  const barIn = custom ? n(m.stockLengthIn) : (stock.find((x) => x.partNumber === m.partNumber)?.barLengthFeet ?? 0) * 12;
  const barCost = custom ? 0 : stock.find((x) => x.partNumber === m.partNumber)?.costPerBar ?? 0;
  const rawIn = m.rawLengthIn === null ? 1 : n(m.rawLengthIn);
  const remnantIn = n(m.remnantIn);
  const difficulty = s.difficulty[input.inspectionDifficulty] ?? 1;
  const asm = input.assemblyOps;
  const asmEach = asm.reduce((t, o) => t + n(o.costEach), 0);
  const asmShipBase = asm.reduce((t, o) => t + (o.ship ? n(o.costEach) : 0), 0);
  const asmLead = asm.reduce((t, o) => t + n(o.leadWeeks), 0);
  const outside = input.outsideOps;
  if (outside.length > 3) warnings.push('Only the first three outside operations are priced, as the workbook does; their lead times all count.');
  const outLead = outside.reduce((t, o) => t + n(o.leadWeeks), 0);
  const programmingTotal = n(input.programmingHours) * s.programmingRate;

  const breaks: MachiningBreak[] = [];
  for (const q of quantities) {
    if (!(q > 0)) continue;
    const r: Record<string, number> = {};
    r['parts_per_bar'] = Math.floor((barIn - remnantIn) / (rawIn + s.kerfAllowanceIn));
    r['raw_material_cost_per_unit'] = custom ? n((m as { unitPrice: number | null }).unitPrice) : (r['parts_per_bar'] > 0 ? barCost / r['parts_per_bar'] : 0);
    r['primary_machining_cost'] = q * (pCycle / 3600) * (primaryRate - (1 - pDuty) * s.operatorLaborRate);
    r['secondary_machining_cost'] = q * (sCycle / 3600) * (secondaryRate - (1 - sDuty) * s.operatorLaborRate);
    r['raw_material_cost'] = q * r['raw_material_cost_per_unit'];
    r['raw_material_markup_cost'] = r['raw_material_cost'] * s.rawMaterialMarkup;
    r['setup_cost'] = n(input.primarySetupHours) * primaryRate + (input.secondaryMachine ? n(input.secondarySetupHours) : 0) * secondaryRate;
    r['vibratory_deburr_cost'] = input.deburr ? Math.ceil(q / atLeastOne(input.partsPerDeburrCycle)) * (s.deburrCycleMinutes / 60) * s.processLaborRate : 0;
    r['sand_blasting_cost'] = input.sandblast ? Math.ceil(q / atLeastOne(input.partsPerSandblastCycle)) * (s.sandblastCycleMinutes / 60) * s.processLaborRate : 0;
    r['cleaning_cost'] = input.cleaning ? Math.ceil(q / atLeastOne(input.partsPerCleaningCycle)) * (s.cleaningCycleMinutes / 60) * s.processLaborRate : 0;
    r['part_marking_cost'] = input.partMarking ? q * (s.partMarkingMinutesPerPart / 60) * s.processLaborRate : 0;
    r['perishable_tooling_cost'] = (r['primary_machining_cost'] + r['secondary_machining_cost']) * n(input.perishableToolingPct);
    r['programming_cost'] = input.programmingAmortized ? programmingTotal : 0;
    r['workholding_cost'] = input.workholding.amortized ? n(input.workholding.cost) : 0;
    r['initial_tooling_cost'] = input.tooling.amortized ? n(input.tooling.cost) : 0;
    r['gaging_cost'] = input.gaging.amortized ? n(input.gaging.cost) : 0;
    r['assembly_cost'] = q * asmEach * (1 + s.assemblyMarkup) + asmShipBase * s.assemblyShippingRate;
    r['outside_operation_cost'] = outside.slice(0, 3).reduce((t, o) => {
      const each = n(o.costEach);
      return t + (each > 0 ? Math.max(each, n(o.lotCharge) / q) * (1 + s.outsideOperationMarkup) + s.outsideOperationShippingRate * each : 0);
    }, 0);
    const boxes = Math.ceil(q / atLeastOne(input.partsPerBox));
    r['packaging_cost'] = input.packaging === 'BULK' ? boxes * n(input.costPerBox) + boxes * (s.bulkPackMinutesPerBox / 60) * s.processLaborRate
      : input.packaging === 'SEPARATE' ? boxes * n(input.costPerBox) + boxes * (s.separatePackMinutesPerBox / 60) * s.processLaborRate : 0;
    r['inspection_sample_size'] = aqlSampleSize(s, input.inspectionLevel, q);
    r['aql_inspection_cost'] = r['inspection_sample_size'] * s.aqlInspectionMinutesPerSample * difficulty * ((pCycle + sCycle) / 3600) * s.processLaborRate;
    r['certificate_cost_total'] = input.coc ? s.certificateCost : 0;
    r['fai_cost'] = input.fai.required ? (n(input.fai.parts) - 1) * (pCycle + sCycle) * difficulty : 0;
    r['cap_study_cost'] = input.capStudy.required ? n(input.capStudy.featuresXParts) * s.capStudyMinutesPerUnit * difficulty : 0;
    r['gage_rr_cost'] = input.gageRr.required ? n(input.gageRr.studies) * s.gageRrCostPerStudy : 0;
    r['qualification_cost'] = r['fai_cost'] + r['cap_study_cost'] + r['gage_rr_cost'];
    r['total_recurring_cost'] = r['primary_machining_cost'] + r['secondary_machining_cost'] + r['raw_material_cost'] + r['raw_material_markup_cost'] + r['setup_cost']
      + r['vibratory_deburr_cost'] + r['sand_blasting_cost'] + r['cleaning_cost'] + r['part_marking_cost'] + r['perishable_tooling_cost']
      + r['programming_cost'] + r['workholding_cost'] + r['initial_tooling_cost'] + r['gaging_cost'] + r['assembly_cost'] + r['outside_operation_cost']
      + r['packaging_cost'] + r['aql_inspection_cost'] + r['certificate_cost_total'];
    r['selling_price_each'] = r['total_recurring_cost'] / q;
    r['revenue'] = r['selling_price_each'] * q;
    r['value_add'] = r['total_recurring_cost'] > 0 ? 1 - r['raw_material_cost'] / r['total_recurring_cost'] : 0;
    r['nre_cost'] = (input.workholding.amortized ? 0 : n(input.workholding.cost)) + (input.gaging.amortized ? 0 : n(input.gaging.cost))
      + (input.programmingAmortized ? 0 : programmingTotal) + (input.tooling.amortized ? 0 : n(input.tooling.cost));
    r['lead_time'] = Math.max(n(input.programmingLeadWeeks), n(input.workholding.leadWeeks), n(input.tooling.leadWeeks), n(input.gaging.leadWeeks))
      + Math.max(n(input.primaryLeadWeeks), n(input.secondaryLeadWeeks)) + Math.max(n(input.fai.leadWeeks), n(input.capStudy.leadWeeks), n(input.gageRr.leadWeeks))
      + asmLead + outLead
      + (q * (pCycle + sCycle) / 3600) / (s.productiveHoursPerShift * atLeastOne(input.operatingShifts) * s.workdaysPerWeek);
    breaks.push({ quantity: q, ...r } as MachiningBreak);
  }
  if (breaks.some((x) => (x['parts_per_bar'] ?? 0) <= 0) && !custom) warnings.push('No part fits in a bar after the remnant and the cut, so material is $0. Check the stock length per part and the remnant.');
  if (breaks.some((x) => (x['qualification_cost'] ?? 0) > 0)) warnings.push('First article, capability and gage R&R are worked out but not in the price or the one-time charge, as in the workbook.');
  const nre = breaks[0]?.['nre_cost'] ?? 0;
  return { breaks, nreCost: nre, leadWeeks: Math.max(0, ...breaks.map((x) => x['lead_time'] ?? 0)), warnings };
}
