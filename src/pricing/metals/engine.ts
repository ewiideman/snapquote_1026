// Metals line pricing: Mack's MTL07 model, ported from SnapQuote 0626
// src/utils/metalsComputationEngine.ts (commit 5920baa, "quantity breaks are ASSEMBLIES").
//
// Per part, at each quantity break (parts = assemblies x partsPerAssembly):
//   material     = sheetPrice / (partsAcross x partsDown) x materialMarkup
//                  partsAcross = floor((sheetLen - lengthMargin) / (partLen + web)), part dims
//                  rounded up to 0.1" first; same for partsDown on width. A fraction of a sheet
//                  at every quantity (no whole-sheet rounding). Mass x $/kg only without a sheet.
//   labor        = sum over operations of
//                  (setupHrs / partsPerAssembly x cellRate) / (1 - scrap) / parts
//                  + (cycleMin / productiveMinPerHr x cellRate) / (1 - scrap)
//   programming  = operations x programMinPerCell x engRate / 60 / parts
//   hardware     = sum(qty x unit cost at the parts quantity) x materialMarkup
//   tooling      = one-time total / (amortizeOverParts or parts)
//   osp          = (unit + lot / request qty) x (1 + markup) x (1 + freight)
//   price        = sum of the above (cell rates are fully loaded: no overhead, no margin)
// Verified in the original against Mack's workbook RFQ_Locus_Origin_021626.xlsx to 4 dp.

import {
  deriveMetalsItemAttributes,
  findMetalsMaterialItem,
  findMetalsWorkCell,
  metalsItemPriceNote,
  metalsItemSheetSpec,
  metalsMaterialDensity,
} from './catalog.ts';
import { isOspPending, ospCostPerPart, ospRatesFromSettings } from './osp.ts';
import { METALS_DEFAULTS } from './seed.ts';
import { effectiveYieldFactor, resolveMetalsNumber } from './settings.ts';
import type {
  MetalsBreakResult,
  MetalsCalculationSettings,
  MetalsCatalog,
  MetalsCostBreakdown,
  MetalsHardwareInput,
  MetalsLineInput,
  MetalsLineOverrides,
  MetalsLineResult,
  MetalsNesting,
  MetalsOperationCost,
  MetalsOperationInput,
  MetalsQuoteTotals,
  MetalsToolingInput,
} from './types.ts';

const MM_PER_IN = 25.4;

type Settings = MetalsCalculationSettings | null | undefined;

function finiteOr0(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Round up to the nearest 0.1 (Excel ROUNDUP(x, 1)), ignoring float dust. */
function roundUpToTenth(x: number): number {
  return Math.ceil(x * 10 - 1e-9) / 10;
}

// ---------------------------------------------------------------------------
// Hardware and tooling

/**
 * Unit cost of one hardware item at an order quantity (parts): the tier with the highest
 * minQty <= qty, else the base unitCost. Tiers with minQty <= 0, a non-finite or a negative
 * cost are ignored. A zero-cost tier is honored.
 */
export function hardwareUnitCostAtQty(
  part: Pick<MetalsHardwareInput, 'unitCost' | 'priceBreaks'>,
  orderQty: number,
): number {
  const base = Number.isFinite(part.unitCost) ? part.unitCost : 0;
  const breaks = part.priceBreaks;
  if (!Array.isArray(breaks) || breaks.length === 0 || !(orderQty > 0)) return base;
  let bestMinQty = 0;
  let bestCost = base;
  for (const tier of breaks) {
    const minQty = Number.isFinite(tier?.minQty) ? tier.minQty : 0;
    const cost = Number.isFinite(tier?.unitCost) ? tier.unitCost : Number.NaN;
    if (!(minQty > 0) || !Number.isFinite(cost) || cost < 0) continue;
    if (minQty <= orderQty && minQty > bestMinQty) {
      bestMinQty = minQty;
      bestCost = cost;
    }
  }
  return bestCost;
}

/**
 * Hardware cost for ONE part AT COST (no markup): sum of quantity x unit cost. Rows with
 * a non-positive or non-finite quantity or cost add nothing. Without orderQty every row
 * prices at its base unitCost.
 */
export function hardwareCostPerPart(hardware: readonly MetalsHardwareInput[] | undefined, orderQty?: number): number {
  if (!Array.isArray(hardware)) return 0;
  return hardware.reduce((sum, p) => {
    const q = Number.isFinite(p.quantity) ? p.quantity : 0;
    const c =
      orderQty !== undefined ? hardwareUnitCostAtQty(p, orderQty) : Number.isFinite(p.unitCost) ? p.unitCost : 0;
    return sum + (q > 0 && c > 0 ? q * c : 0);
  }, 0);
}

/**
 * Total one-time tooling. The itemized list wins whenever the array is present, so an
 * empty list means zero; the legacy lump sum applies only when there is no list.
 */
export function toolingTotal(tooling: MetalsToolingInput | undefined): number {
  const items = tooling?.items;
  if (Array.isArray(items)) {
    return items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
  }
  return finiteOr0(tooling?.lumpSum);
}

/**
 * What tooling contributes to the unit price, for stripping it when tooling is billed as
 * its own line: tooling x (price / cost). Under MTL07 price equals cost, so this is the
 * tooling per part.
 */
export function toolingShareOfPrice(result: Pick<MetalsBreakResult, 'perPart' | 'unitCost' | 'unitPrice'>): number {
  const tooling = result.perPart.tooling;
  const cost = result.unitCost;
  const price = result.unitPrice;
  if (!(tooling > 0) || !(cost > 0) || !(price > 0)) return 0;
  return tooling * (price / cost);
}

// ---------------------------------------------------------------------------
// Sheet nesting

export type MetalsNestingParams = {
  webIn: number;
  lengthMarginIn: number;
  widthMarginIn: number;
  materialMarkup: number;
};

/** Nesting knobs: line override, then settings, then METALS_DEFAULTS. Markup has no line override. */
export function resolveNestingParams(overrides: MetalsLineOverrides | undefined, settings: Settings): MetalsNestingParams {
  return {
    webIn: resolveMetalsNumber(overrides?.nestWebIn, settings?.nestWebIn, METALS_DEFAULTS.nestWebIn),
    lengthMarginIn: resolveMetalsNumber(
      overrides?.sheetLengthMarginIn,
      settings?.sheetLengthMarginIn,
      METALS_DEFAULTS.sheetLengthMarginIn,
    ),
    widthMarginIn: resolveMetalsNumber(
      overrides?.sheetWidthMarginIn,
      settings?.sheetWidthMarginIn,
      METALS_DEFAULTS.sheetWidthMarginIn,
    ),
    materialMarkup: resolveMetalsNumber(undefined, settings?.materialMarkup, METALS_DEFAULTS.materialMarkup),
  };
}

export type MetalsSheetInput = { priceUsd?: number; lengthMm?: number; widthMm?: number };
export type MetalsSheetUsage = MetalsNesting & { materialCostPerPart: number };

/**
 * Mack MTL07 nesting: each part is charged its fraction of a sheet x markup, at any
 * quantity. Undefined when there is no priced, sized sheet, no part length and width,
 * or the part does not fit (it must not price as a fraction of a sheet then).
 */
export function computeSheetUsage(
  sheet: MetalsSheetInput,
  part: { lengthMm?: number; widthMm?: number },
  parts: number,
  params: MetalsNestingParams,
): MetalsSheetUsage | undefined {
  const sheetPrice = sheet.priceUsd ?? 0;
  const sheetWmm = sheet.widthMm ?? 0;
  const sheetLmm = sheet.lengthMm ?? 0;
  const partWmm = part.widthMm ?? 0;
  const partLmm = part.lengthMm ?? 0;
  if (!(sheetPrice > 0) || !(sheetWmm > 0) || !(sheetLmm > 0)) return undefined;
  if (!(partWmm > 0) || !(partLmm > 0)) return undefined;

  const partLIn = roundUpToTenth(partLmm / MM_PER_IN);
  const partWIn = roundUpToTenth(partWmm / MM_PER_IN);
  const usableLIn = sheetLmm / MM_PER_IN - params.lengthMarginIn;
  const usableWIn = sheetWmm / MM_PER_IN - params.widthMarginIn;

  const partsAcross = Math.floor(usableLIn / (partLIn + params.webIn) + 1e-9);
  const partsDown = Math.floor(usableWIn / (partWIn + params.webIn) + 1e-9);
  const partsPerSheet = partsAcross * partsDown;
  if (!(partsPerSheet >= 1)) return undefined;

  return {
    partsAcross,
    partsDown,
    partsPerSheet,
    sheetsUsed: parts > 0 ? Math.ceil(parts / partsPerSheet) : 0,
    materialCostPerPart: (sheetPrice / partsPerSheet) * params.materialMarkup,
  };
}

// ---------------------------------------------------------------------------
// Line resolution against the catalog

type ResolvedMaterial = {
  sheet: MetalsSheetInput;
  name: string;
  stockForm: string;
  thicknessMm: number | undefined;
  densityKgPerM3: number;
  densityKnown: boolean;
  pricePerKg: number;
};

function resolveMaterial(input: MetalsLineInput, catalog: MetalsCatalog, warnings: string[] | null): ResolvedMaterial {
  const m = input.material ?? {};
  const itemNumber = m.itemNumber?.trim();
  const item = itemNumber ? findMetalsMaterialItem(catalog, itemNumber) : undefined;
  const attrs = item ? deriveMetalsItemAttributes(item.itemNumber, item.description) : undefined;
  const spec = metalsItemSheetSpec(item);

  if (warnings && itemNumber && !input.laborOnly) {
    if (!item) {
      warnings.push(`Material item "${itemNumber}" is not in the catalog; sheet price and size must be entered on the line.`);
    } else {
      if (item.priceUsd === null && m.sheetPriceUsd === undefined) {
        warnings.push(`Material item "${item.itemNumber}" has no price: ${metalsItemPriceNote(item)}`);
      }
      if (!attrs && (m.sheetLengthMm === undefined || m.sheetWidthMm === undefined)) {
        warnings.push(`Material item "${item.itemNumber}" does not decode to a sheet size; enter the sheet size on the line.`);
      }
    }
  }

  const name = m.name ?? attrs?.alloy ?? '';
  const density =
    m.densityKgPerM3 !== undefined
      ? { densityKgPerM3: m.densityKgPerM3, known: true }
      : attrs
        ? { densityKgPerM3: attrs.densityKgPerM3, known: true }
        : metalsMaterialDensity(name);

  return {
    sheet: {
      priceUsd: m.sheetPriceUsd ?? spec?.priceUsd,
      lengthMm: m.sheetLengthMm ?? attrs?.sheetLengthMm,
      widthMm: m.sheetWidthMm ?? attrs?.sheetWidthMm,
    },
    name,
    stockForm: m.stockForm ?? (item ? 'Sheet' : ''),
    thicknessMm: input.blank?.thicknessMm ?? attrs?.thicknessMm,
    densityKgPerM3: density.densityKgPerM3,
    densityKnown: density.known,
    pricePerKg: finiteOr0(m.pricePerKg),
  };
}

function operationRate(op: MetalsOperationInput, catalog: MetalsCatalog): number {
  const cell = findMetalsWorkCell(catalog, op.workCell);
  return op.ratePerHour ?? cell?.hourlyCellRate ?? 0;
}

function operationLabel(op: MetalsOperationInput, index: number): string {
  return op.name?.trim() || op.workCell?.trim() || `#${index + 1}`;
}

/** Mass of one part, kg. Rectangular blank or tube by stock form, divided by yield. */
function materialMassPerPart(input: MetalsLineInput, mat: ResolvedMaterial, settings: Settings): number {
  const b = input.blank ?? {};
  if (b.weightPerPartKg && b.weightPerPartKg > 0) return b.weightPerPartKg;
  const yieldFactor = effectiveYieldFactor(mat.stockForm, input.material?.yieldFactor, settings);
  const t = mat.thicknessMm;
  const rect = (): number =>
    t && b.widthMm && b.lengthMm ? (t / 1000) * (b.widthMm / 1000) * (b.lengthMm / 1000) * (1 / yieldFactor) : 0;

  let volumeM3 = 0;
  switch (mat.stockForm.toLowerCase()) {
    case 'sheet':
    case 'plate':
    case 'bar':
      volumeM3 = rect();
      break;
    case 'tube':
      if (b.odMm && b.lengthMm) {
        const odM = b.odMm / 1000;
        const idM = (b.idMm || 0) / 1000;
        volumeM3 = Math.PI * ((odM / 2) ** 2 - (idM / 2) ** 2) * (b.lengthMm / 1000) * (1 / yieldFactor);
      }
      break;
    default:
      volumeM3 = rect();
      if (volumeM3 === 0 && b.odMm && b.lengthMm) {
        const odM = b.odMm / 1000;
        volumeM3 = Math.PI * (odM / 2) ** 2 * (b.lengthMm / 1000) * (1 / yieldFactor);
      }
      break;
  }
  return volumeM3 * mat.densityKgPerM3;
}

/** Mass x $/kg less scrap credit (recovery % x scrap $/kg x mass x (1 - yield)), clamped at 0. */
function massMaterialCost(input: MetalsLineInput, mat: ResolvedMaterial, kg: number, settings: Settings): number {
  const gross = kg * mat.pricePerKg;
  let credit = 0;
  const recovery = resolveMetalsNumber(
    input.material?.scrapRecoveryPct,
    settings?.scrapRecoveryPct,
    METALS_DEFAULTS.scrapRecoveryPct,
  );
  if (recovery > 0) {
    const scrapPrice = resolveMetalsNumber(
      input.material?.scrapPricePerKg,
      settings?.scrapPricePerKg,
      METALS_DEFAULTS.scrapPricePerKg,
    );
    if (scrapPrice > 0) {
      const yieldFactor = effectiveYieldFactor(mat.stockForm, input.material?.yieldFactor, settings);
      credit = recovery * scrapPrice * kg * (1 - yieldFactor);
    }
  }
  return Math.max(0, gross - credit);
}

// ---------------------------------------------------------------------------
// Validation

/**
 * What must be fixed before a line can be quoted. Messages are the original's, word for
 * word. A labor-only line is exempt from every material and geometry rule.
 */
export function validateMetalsLine(input: MetalsLineInput, catalog: MetalsCatalog): string[] {
  const errors: string[] = [];
  const laborOnly = input.laborOnly === true;
  const mat = resolveMaterial(input, catalog, null);

  if (!input.partNumber?.trim()) errors.push('Part number is required');
  if (!laborOnly && !mat.name.trim()) errors.push('Material specification is required');
  if (!laborOnly && !mat.stockForm.trim()) errors.push('Stock form is required');

  const hasSheet = (mat.sheet.priceUsd ?? 0) > 0 && (mat.sheet.widthMm ?? 0) > 0 && (mat.sheet.lengthMm ?? 0) > 0;
  if (!laborOnly && !hasSheet && !(mat.pricePerKg > 0)) {
    errors.push('Material needs a sheet price (from the item number) or a raw material $/kg');
  }

  const ops = input.operations ?? [];
  const opsWithTime = ops.filter((op) => (op.runMinutesPerPiece ?? 0) > 0 || (op.setupHours ?? 0) > 0);
  if (opsWithTime.length === 0) errors.push('At least one operation with setup or run time is required');
  if (ops.some((op) => (op.setupHours ?? 0) < 0 || (op.runMinutesPerPiece ?? 0) < 0)) {
    errors.push('Operation times cannot be negative');
  }

  for (const part of input.hardware ?? []) {
    const tiers = part.priceBreaks;
    if (!Array.isArray(tiers)) continue;
    const label = part.label?.trim() || 'hardware item';
    const seen = new Set<number>();
    for (const tier of tiers) {
      if (!(tier.minQty > 0)) {
        errors.push(`Qty pricing on "${label}": each tier needs a From-qty of 1 or more`);
        break;
      }
      if (!(Number.isFinite(tier.unitCost) && tier.unitCost >= 0)) {
        errors.push(`Qty pricing on "${label}": each tier needs a cost of 0 or more`);
        break;
      }
      if (seen.has(tier.minQty)) {
        errors.push(`Qty pricing on "${label}": two tiers start at qty ${tier.minQty}`);
        break;
      }
      seen.add(tier.minQty);
    }
  }

  const timedWithoutRate = opsWithTime.filter((op) => !(operationRate(op, catalog) > 0));
  if (timedWithoutRate.length > 0) {
    errors.push(
      `${timedWithoutRate.length} operation(s) have time but no work cell — pick a work cell so they are priced`,
    );
  }

  const b = input.blank ?? {};
  if (!laborOnly && !b.weightPerPartKg) {
    const hasRect = mat.thicknessMm && b.widthMm && b.lengthMm;
    const hasRound = b.odMm && b.lengthMm;
    if (!hasRect && !hasRound) errors.push('Either weight per unit or geometric dimensions are required');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Pricing

/** True when the line's material is costed by sheet nesting (a geometry question, not a quantity one). */
export function isSheetCosted(input: MetalsLineInput, settings: Settings, catalog: MetalsCatalog): boolean {
  if (input.laborOnly === true) return false;
  const mat = resolveMaterial(input, catalog, null);
  return computeSheetUsage(mat.sheet, input.blank ?? {}, 1, resolveNestingParams(input.overrides, settings)) !== undefined;
}

/**
 * Price one Metals line at each quantity break. Breaks are ASSEMBLIES; every amortized
 * cost (setup, programming, tooling, freight) and the hardware price tier use the part
 * count, assemblies x partsPerAssembly, and extendedPrice = unitPrice x parts.
 * Missing data produces warnings, never an exception.
 */
export function priceMetalsLine(
  input: MetalsLineInput,
  settings: MetalsCalculationSettings | null,
  catalog: MetalsCatalog,
): MetalsLineResult {
  const warnings = validateMetalsLine(input, catalog);
  const laborOnly = input.laborOnly === true;

  const ppaRaw = input.partsPerAssembly;
  let partsPerAssembly = 1;
  if (ppaRaw !== undefined) {
    if (Number.isFinite(ppaRaw) && ppaRaw > 0) partsPerAssembly = ppaRaw;
    else warnings.push(`Parts per assembly ${String(ppaRaw)} is not a positive number; 1 is used.`);
  }

  const mat = resolveMaterial(input, catalog, warnings);
  const nestingParams = resolveNestingParams(input.overrides, settings);
  const blank = input.blank ?? {};
  const sheetCosted =
    !laborOnly && computeSheetUsage(mat.sheet, blank, 1, nestingParams) !== undefined;

  if (!laborOnly && !sheetCosted) {
    const hasSheet = (mat.sheet.priceUsd ?? 0) > 0 && (mat.sheet.widthMm ?? 0) > 0 && (mat.sheet.lengthMm ?? 0) > 0;
    if (hasSheet && (blank.lengthMm ?? 0) > 0 && (blank.widthMm ?? 0) > 0) {
      warnings.push('The part does not fit on the sheet; material falls back to mass x $/kg.');
    } else if (hasSheet) {
      warnings.push('Sheet nesting needs the part length and width; material falls back to mass x $/kg.');
    }
    if (!(mat.pricePerKg > 0)) {
      warnings.push('No usable sheet and no $/kg: material is priced at $0.');
    } else if (!blank.weightPerPartKg && input.material?.densityKgPerM3 === undefined && !mat.densityKnown) {
      warnings.push(`Unknown material "${mat.name}"; steel density (7870 kg/m3) is assumed for mass.`);
    }
  }

  const scrapRaw = resolveMetalsNumber(undefined, settings?.scrapFactor, METALS_DEFAULTS.scrapFactor);
  const scrapFactor = scrapRaw >= 0 && scrapRaw < 1 ? scrapRaw : 0;
  const productiveMin = resolveMetalsNumber(
    undefined,
    settings?.productiveMinutesPerHour,
    METALS_DEFAULTS.productiveMinutesPerHour,
  );
  const programMinPerCell = resolveMetalsNumber(
    undefined,
    settings?.programMinutesPerWorkCell,
    METALS_DEFAULTS.programMinutesPerWorkCell,
  );
  const engRate = resolveMetalsNumber(undefined, settings?.engineeringRatePerHour, METALS_DEFAULTS.engineeringRatePerHour);

  const ops = input.operations ?? [];
  for (const [i, op] of ops.entries()) {
    if (op.workCell && op.ratePerHour === undefined && !findMetalsWorkCell(catalog, op.workCell)) {
      warnings.push(`Operation ${operationLabel(op, i)}: work cell "${op.workCell}" is not in the catalog; it is priced at $0.`);
    }
  }
  const programmedCells = ops.filter((op) => op.name?.trim() || op.workCell?.trim()).length;

  const overrides = input.overrides ?? {};
  const legacyLaborRate = finiteOr0(overrides.laborRatePerHour);
  const qaMinutes = resolveMetalsNumber(overrides.qaMinutesPerPart, settings?.qaMinutesPerUnit, METALS_DEFAULTS.qaMinutesPerUnit);
  const packMinutes = resolveMetalsNumber(
    overrides.packagingMinutesPerPart,
    settings?.packagingMinutesPerUnit,
    METALS_DEFAULTS.packagingMinutesPerUnit,
  );
  if ((qaMinutes > 0 || packMinutes > 0) && !(legacyLaborRate > 0)) {
    warnings.push('QA or packaging minutes are set but there is no labor rate; they are priced at $0.');
  }
  const freightPerShipment = resolveMetalsNumber(
    overrides.freightPerShipment,
    settings?.freightPerShipment,
    METALS_DEFAULTS.freightPerShipment,
  );
  const shipments = resolveMetalsNumber(
    overrides.shipmentsPerYearPerTier,
    settings?.shipmentsPerYearPerTier,
    METALS_DEFAULTS.shipmentsPerYearPerTier,
  );
  const packagingMaterial = resolveMetalsNumber(
    overrides.packagingMaterialPerPart,
    settings?.packagingMaterialPerUnit,
    METALS_DEFAULTS.packagingMaterialPerUnit,
  );

  const ospRates = ospRatesFromSettings(settings);
  const osp = input.outsideProcessing ?? [];
  const ospPerPart = osp.reduce((sum, r) => sum + ospCostPerPart(r, ospRates), 0);
  const pending = osp.filter(isOspPending);
  if (pending.length > 0) {
    warnings.push(
      `${pending.length} outside processing request(s) not priced by Procurement yet: ${pending.map((r) => r.description).join(', ')}.`,
    );
  }

  const tooling = toolingTotal(input.tooling);
  const massKg = laborOnly ? 0 : materialMassPerPart(input, mat, settings);
  if (!laborOnly && !sheetCosted && mat.pricePerKg > 0 && !(massKg > 0)) {
    warnings.push('Material mass is 0: enter the part weight or its dimensions.');
  }

  if (input.quantityBreaks.length === 0) warnings.push('No quantity breaks: nothing is priced.');

  const breaks: MetalsBreakResult[] = [];
  for (const qb of input.quantityBreaks) {
    if (!(Number.isFinite(qb.assemblies) && qb.assemblies > 0)) {
      warnings.push(`Quantity break "${qb.label}" has no positive quantity; it is not priced.`);
      continue;
    }
    const parts = qb.assemblies * partsPerAssembly;

    const usage = laborOnly ? undefined : computeSheetUsage(mat.sheet, blank, parts, nestingParams);
    const material = laborOnly ? 0 : usage ? usage.materialCostPerPart : massMaterialCost(input, mat, massKg, settings);

    const operations: MetalsOperationCost[] = [];
    let labor = 0;
    for (const [i, op] of ops.entries()) {
      const rate = operationRate(op, catalog);
      if (!(rate > 0)) continue;
      const setupCost = ((finiteOr0(op.setupHours) / partsPerAssembly) * rate) / (1 - scrapFactor);
      const runPerPart = ((finiteOr0(op.runMinutesPerPiece) / productiveMin) * rate) / (1 - scrapFactor);
      const setupPerPart = parts > 0 ? setupCost / parts : 0;
      labor += setupPerPart + runPerPart;
      operations.push({
        name: operationLabel(op, i),
        workCell: op.workCell ?? null,
        ratePerHour: rate,
        setupPerPart,
        runPerPart,
        totalPerPart: setupPerPart + runPerPart,
      });
    }

    const perPart: MetalsCostBreakdown = {
      material,
      labor,
      qaLabor: (qaMinutes / 60) * legacyLaborRate,
      packagingLabor: (packMinutes / 60) * legacyLaborRate,
      programming: programmedCells > 0 ? (programmedCells * programMinPerCell * (engRate / 60)) / parts : 0,
      osp: Number.isFinite(ospPerPart) && ospPerPart > 0 ? ospPerPart : 0,
      tooling: tooling > 0 ? tooling / (input.tooling?.amortizeOverParts || parts) : 0,
      freight: (freightPerShipment * shipments) / parts,
      packagingMaterial,
      hardware: hardwareCostPerPart(input.hardware, parts) * nestingParams.materialMarkup,
      overhead: 0,
      margin: 0,
    };
    const unitCost =
      perPart.material +
      perPart.labor +
      perPart.qaLabor +
      perPart.packagingLabor +
      perPart.programming +
      perPart.osp +
      perPart.tooling +
      perPart.freight +
      perPart.packagingMaterial +
      perPart.hardware;
    const unitPrice = unitCost;

    breaks.push({
      label: qb.label,
      assemblies: qb.assemblies,
      parts,
      nesting: usage
        ? {
            partsAcross: usage.partsAcross,
            partsDown: usage.partsDown,
            partsPerSheet: usage.partsPerSheet,
            sheetsUsed: usage.sheetsUsed,
          }
        : null,
      materialKgPerPart: massKg,
      perPart,
      operations,
      unitCost,
      unitPrice,
      extendedPrice: unitPrice * parts,
    });
  }

  return { partNumber: input.partNumber, partsPerAssembly, sheetCosted, breaks, warnings };
}

/** Sum of extended prices across lines, per break label, in the order of first appearance. */
export function metalsQuoteTotals(lines: readonly MetalsLineResult[]): MetalsQuoteTotals {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const line of lines) {
    for (const b of line.breaks) {
      if (!totals.has(b.label)) {
        order.push(b.label);
        totals.set(b.label, 0);
      }
      totals.set(b.label, (totals.get(b.label) ?? 0) + b.extendedPrice);
    }
  }
  return { byBreak: order.map((label) => ({ label, extendedPrice: totals.get(label) ?? 0 })) };
}
