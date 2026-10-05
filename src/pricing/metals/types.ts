// Input and output types for the Metals line pricing engine (Mack MTL07 model).
// Ported from SnapQuote 0626: src/types/shared.ts (MetalsLineItem, MetalsCalcPerTier)
// and src/utils/metalsCalculationSettings.ts. Lengths in mm, masses in kg, money in USD.

/** Stock forms with a default yield factor (mass costing only). */
export type MetalsStockForm =
  | 'Sheet'
  | 'Plate'
  | 'Bar'
  | 'Tube'
  | 'Angle'
  | 'Extrusion'
  | 'Casting'
  | 'Other';

/** One work cell from the MTL07 facility rate sheet. */
export type MetalsWorkCell = {
  /** Name exactly as printed on the rate sheet; operations refer to it by this. */
  name: string;
  /** $/hour, fully loaded (labor, machine and burden). The only rate charged per operation. */
  hourlyCellRate: number;
  /** $/hour as printed. Reference only; never enters a price. */
  setUpCharge: number;
  /** Set-up charge / 60 as printed. Reference only. */
  setUpChargePerMin: number;
  /** Standard setup time as a fraction of an hour (0.167 = 10 min). */
  setUpTimeHours: number;
  /** Set-Up Cost column as printed. Reference only. */
  setUpCostAsPrinted: number;
  sortOrder: number;
};

export type MetalsPriceBasis = 'sixMonthAverage' | 'twelveMonthAverage' | 'none';

/** One purchased sheet-stock item from the XA purchase-order catalog. */
export type MetalsMaterialItem = {
  /** Mack item number, e.g. "SA0205048096". */
  itemNumber: string;
  description: string;
  /** USD per purchased sheet (not per kg). Null when never purchased in the export. */
  priceUsd: number | null;
  priceBasis: MetalsPriceBasis;
  purchaseCount: number;
  /** ISO date, null when never purchased. */
  lastPurchaseDate: string | null;
  sortOrder: number;
};

/** Reference data the engine looks up by name or item number. */
export type MetalsCatalog = {
  workCells: readonly MetalsWorkCell[];
  materialItems: readonly MetalsMaterialItem[];
};

/**
 * Org-wide calculation settings (the metals_calculation_settings JSON document,
 * normalized). Every field is optional: absent means the line value or the
 * METALS_DEFAULTS constant applies. Precedence: line override, then settings, then defaults.
 */
export type MetalsCalculationSettings = {
  yieldFactors?: Partial<Record<MetalsStockForm, number>>;
  /** Multiplier on purchased sheet and hardware cost, e.g. 1.2. */
  materialMarkup?: number;
  nestWebIn?: number;
  sheetLengthMarginIn?: number;
  sheetWidthMarginIn?: number;
  /** Decimal, e.g. 0.03. Every labor cost is divided by (1 - scrapFactor). */
  scrapFactor?: number;
  productiveMinutesPerHour?: number;
  engineeringRatePerHour?: number;
  programMinutesPerWorkCell?: number;
  /** Decimal markup on outside processing, e.g. 0.20. */
  ospMarkupPct?: number;
  /** Decimal freight on outside processing after markup, e.g. 0.11. */
  ospFreightPct?: number;
  // Legacy knobs, still read by the engine (all default to zero effect).
  scrapRecoveryPct?: number;
  scrapPricePerKg?: number;
  qaMinutesPerUnit?: number;
  packagingMinutesPerUnit?: number;
  shipmentsPerYearPerTier?: number;
  freightPerShipment?: number;
  packagingMaterialPerUnit?: number;
  // Legacy knobs parsed for old documents; the MTL07 model never applies them.
  variableOverheadPct?: number;
  fixedOverheadPct?: number;
  targetMarginPct?: number;
};

/** A quantity break, stated in ASSEMBLIES as Mack's SUMMARY sheet states it. */
export type MetalsQuantityBreak = {
  label: string;
  assemblies: number;
};

/** The part blank (geometry of one finished part). */
export type MetalsBlank = {
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  /** Tube or round bar outside diameter (mass costing only). */
  odMm?: number;
  /** Tube inside diameter (mass costing only). */
  idMm?: number;
  /** Known mass of one part; when set, geometry is not used for mass. */
  weightPerPartKg?: number;
};

export type MetalsMaterialInput = {
  /** Catalog item number of the purchased sheet. Supplies sheet price and size, alloy, density and thickness. */
  itemNumber?: string;
  /** Per-line overrides of the catalog sheet (Mack sometimes buys off-standard sheets). */
  sheetPriceUsd?: number;
  sheetLengthMm?: number;
  sheetWidthMm?: number;
  /** Alloy name, e.g. "Al 5052-H32". Used for density when no density is given or derived. */
  name?: string;
  stockForm?: MetalsStockForm;
  densityKgPerM3?: number;
  /** 0-1; mass costing only. */
  yieldFactor?: number;
  /** $/kg; used only when the line has no usable sheet (mass costing). */
  pricePerKg?: number;
  scrapRecoveryPct?: number;
  scrapPricePerKg?: number;
};

/** An operation booked at a work cell. */
export type MetalsOperationInput = {
  name?: string;
  /** Work cell name from the catalog; supplies the hourly cell rate. */
  workCell?: string;
  /** Setup time in hours for the operation (Mack's sheet states hours). */
  setupHours: number;
  /** Cycle time in minutes per piece. Costed against productive minutes per hour. */
  runMinutesPerPiece: number;
  /** Overrides the work cell's hourly rate for this operation. */
  ratePerHour?: number;
};

/** At an order quantity of minQty parts or more, one item costs unitCost. */
export type MetalsHardwarePriceBreak = {
  minQty: number;
  unitCost: number;
};

/** PEM fastener, rivet or other purchased hardware in ONE finished part. */
export type MetalsHardwareInput = {
  id?: string;
  label: string;
  /** How many go into one part. */
  quantity: number;
  /** Cost of one item; the fallback below the lowest price break. */
  unitCost: number;
  priceBreaks?: MetalsHardwarePriceBreak[];
};

export type MetalsToolingItem = {
  id?: string;
  label: string;
  /** One-time cost. */
  amount: number;
};

export type MetalsToolingInput = {
  /** Itemized tooling. When the array is present (even empty) it wins over the lump sum. */
  items?: MetalsToolingItem[];
  /** Legacy single lump sum, honored only when items is absent. */
  lumpSum?: number;
  /** Parts to amortize over. Absent or 0: the break's part count. */
  amortizeOverParts?: number;
};

export type MetalsOspStatus = 'draft' | 'sent' | 'quoted' | 'accepted';

/** An outside processing request (anodize, plate, heat treat...) and Procurement's price. */
export type MetalsOspInput = {
  description: string;
  status: MetalsOspStatus;
  unitPrice: number | null;
  lotCharge: number | null;
  /** Request quantity the lot charge is spread over. */
  quantity: number | null;
};

/** Per-line overrides of org settings, plus legacy inputs. */
export type MetalsLineOverrides = {
  nestWebIn?: number;
  sheetLengthMarginIn?: number;
  sheetWidthMarginIn?: number;
  qaMinutesPerPart?: number;
  packagingMinutesPerPart?: number;
  /** Legacy line labor rate; only QA and packaging minutes are charged at it. */
  laborRatePerHour?: number;
  freightPerShipment?: number;
  shipmentsPerYearPerTier?: number;
  packagingMaterialPerPart?: number;
};

/** One Metals line: one part. */
export type MetalsLineInput = {
  partNumber: string;
  description?: string;
  /** Assembly work on already-quoted components: no material of its own, by design. */
  laborOnly?: boolean;
  /** Parts in one assembly (Mack "Quantity per", I4). Default 1. */
  partsPerAssembly?: number;
  quantityBreaks: MetalsQuantityBreak[];
  blank?: MetalsBlank;
  material?: MetalsMaterialInput;
  operations: MetalsOperationInput[];
  hardware?: MetalsHardwareInput[];
  tooling?: MetalsToolingInput;
  outsideProcessing?: MetalsOspInput[];
  overrides?: MetalsLineOverrides;
};

/** Cost per PART, itemized. Under MTL07 there is no overhead or margin layer: both are 0. */
export type MetalsCostBreakdown = {
  /** Sheet fraction x sheet price x material markup, or mass x $/kg less scrap credit. */
  material: number;
  /** Sum over operations of setup share + run. */
  labor: number;
  qaLabor: number;
  packagingLabor: number;
  /** Programming / NRE amortized over the break's parts. */
  programming: number;
  /** Outside processing including its markup and freight. */
  osp: number;
  tooling: number;
  freight: number;
  packagingMaterial: number;
  /** Purchased hardware x material markup. */
  hardware: number;
  overhead: number;
  margin: number;
};

export type MetalsOperationCost = {
  name: string;
  workCell: string | null;
  ratePerHour: number;
  setupPerPart: number;
  runPerPart: number;
  totalPerPart: number;
};

export type MetalsNesting = {
  partsAcross: number;
  partsDown: number;
  partsPerSheet: number;
  /** Whole sheets the break would consume. Informational; not charged. */
  sheetsUsed: number;
};

export type MetalsBreakResult = {
  label: string;
  /** The break as entered, in assemblies. */
  assemblies: number;
  /** Parts amortized over: assemblies x partsPerAssembly. */
  parts: number;
  nesting: MetalsNesting | null;
  materialKgPerPart: number;
  perPart: MetalsCostBreakdown;
  operations: MetalsOperationCost[];
  /** Sum of perPart. */
  unitCost: number;
  /** Equals unitCost under MTL07 (fully loaded rates, no margin). */
  unitPrice: number;
  /** unitPrice x parts. */
  extendedPrice: number;
};

export type MetalsLineResult = {
  partNumber: string;
  partsPerAssembly: number;
  /** True when material is costed by sheet nesting rather than by mass. */
  sheetCosted: boolean;
  breaks: MetalsBreakResult[];
  /** Missing or doubtful data, in plain words. Never thrown. */
  warnings: string[];
};

export type MetalsQuoteTotals = {
  byBreak: { label: string; extendedPrice: number }[];
};
