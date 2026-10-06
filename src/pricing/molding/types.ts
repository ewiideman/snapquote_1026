// Types of the Molding (ADC) calculator: ADC's "Tool Development Form" model, as the old SnapQuote ran it.

export interface MoldingResin {
  name: string;
  densityLbPerIn3: number;
  pricePerLb: number;
  /** As the source has them -- swapped in every row (max 20, min 80). Read as a range, smaller to larger. */
  barrelMaxPct: number;
  barrelMinPct: number;
  sortOrder: number;
}

export interface MoldingPress {
  id: string;
  plant: string;
  number: string;
  tons: number;
  /** Barrel capacity, oz (styrene), as the press list states it. */
  barrelOz: number;
  make: string | null;
  type: string | null;
  maxTruckLb: number | null;
  maxCraneLb: number | null;
  platenLengthIn: number | null;
  platenWidthIn: number | null;
  sortOrder: number;
}

/** One rung of a tonnage ladder. Rungs are tried in order; the first whose conditions all hold applies. */
export interface TonnageRung { gt?: number; gte?: number; lt?: number; eq?: number; usd: number }

export interface MoldingSettings {
  /** Press hourly rate by tonnage. */
  pressRate: { rungs: TonnageRung[]; otherwise: number };
  /** One setup's cost by tonnage; multiplied by setupsPerYear and spread over the EAU. */
  setupCost: { rungs: TonnageRung[]; otherwise: number };
  setupsPerYear: number;
  /** Scrap allowed for in press time: parts per hour × (1 - this). */
  moldingScrap: number;
  /** Material: resin $ × shot lb per cavity × (1 + materialAdder) ÷ (1 - materialScrap). */
  materialAdder: number;
  materialScrap: number;
  workingDaysPerYear: number;
  steel: Record<string, { usdPerLb: number; densityLbPerIn3: number }>;
  chinaFactor: number;
  portugalFactor: number;
}

export type ToolingChoice = 'domestic' | 'china' | 'portugal' | 'none';

export interface MoldingInput {
  resin: string;
  /** A press from the list, or null to take the smallest press that fits (the old app's selection). */
  pressId: string | null;
  eau: number | null;
  cavitation: number | null;
  cycleTimeSec: number | null;
  partVolumeIn3: number | null;
  wallThicknessIn: number | null;
  runnerLengthIn: number | null;
  footprintIn2: number | null;
  /** tons per square inch of projected area, as the minimum-tonnage formula reads it. */
  moldingPressure: number | null;
  flowLengthIn: number | null;
  partLengthIn: number | null;
  partWidthIn: number | null;
  partHeightIn: number | null;
  tool: {
    steelType: string;
    moldType: '2 Plate' | '3 Plate' | 'MUD' | string;
    sideActionQty: number | null;
    gateType: string;
    gatesCount: number | null;
    runnerType: string;
    ejectionSide: 'Standard' | 'Reverse' | string;
    complexity: number | null;
    /** ADC's own figures, used instead of the computed ones when given. */
    domesticUsd?: number | null;
    chinaUsd?: number | null;
    portugalUsd?: number | null;
  };
  /** Which mold estimate goes on the quote as its one-time charge. */
  tooling: ToolingChoice;
}

export interface MoldingResult {
  press: { id: string; tons: number; chosen: 'by_estimator' | 'smallest_that_fits' } | null;
  partWeightOz: number;
  runnerWeightOz: number;
  shotWeightOz: number;
  materialPerPart: number;
  moldingPerPart: number;
  setupPerPart: number;
  /** The price per piece, the same at every quantity (setup is spread over the EAU, not the quantity). */
  perPart: number;
  process: {
    minTonnage: number; shotToBarrelPct: number; minBarrelOz: number; maxBarrelOz: number; flowRatio: number;
    pressDaysPerYear: number; pressUtilizationPct: number; resinLbPerYear: number; dryerLbPerHour: number; hopperLb: number; partsPerHour: number;
  };
  tool: { weightLb: number; domestic: number; china: number; portugal: number; chosen: ToolingChoice; oneTimeUsd: number; oneTimeLabel: string };
  warnings: string[];
}
