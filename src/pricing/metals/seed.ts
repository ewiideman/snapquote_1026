// Metals reference data as typed constants, for seeding a fresh database and for tests.
//
// Sources (SnapQuote 0626, backend-postgres/migrations and src/constants):
// - METALS_WORK_CELLS: migration 047_metals_work_cells_rev_f.sql (MTL07 Rev F, from the
//   OPERATIONS tab of Mack's RFQ_Locus_Origin_021626.xlsx). Rate, setup charge, setup time
//   and sort order are 047's. setUpChargePerMin and setUpCostAsPrinted are not in 047; they
//   come from src/constants/metalsFacilityRates.ts (same Rev F sheet) and never enter a price.
//   047 supersedes 041 (older revision, about 3% lower) and deletes the old
//   "Trumpf TC500L Punch Laser Combo" row (renamed TC600L).
// - METALS_MATERIAL_ITEMS: migration 046_metals_material_items.sql, all 71 rows. Prices are
//   per purchased sheet, averaged over 2025-03-11 to 2025-09-10 of Mack's XA purchase-order
//   export ("Mat Data.xlsx"); twelveMonthAverage rows fall back to the whole export; 25 rows
//   were never purchased and carry no price.
// - METALS_DEFAULTS: migration 031_metals_calculation_settings.sql seeds an EMPTY settings
//   document ('{}'), so the effective defaults are the code constants in
//   src/constants/metalsReferenceData.ts, copied here. The MTL07 values were decoded from
//   Mack's RFQ_Locus_Origin_021626.xlsx (see the comments on each field).
// - METALS_DENSITIES and METALS_DEFAULT_YIELD_FACTORS: src/constants/metalsReferenceData.ts
//   (standard engineering densities; yield factors used only by mass costing).

import type { MetalsMaterialItem, MetalsStockForm, MetalsWorkCell } from './types.ts';

export const METALS_PRICE_WINDOW = { start: '2025-03-11', end: '2025-09-10' } as const;

export const METALS_DEFAULTS = {
  // MTL07 material nesting.
  /** Multiplier on purchased sheet and hardware cost (Mack: 1.20). */
  materialMarkup: 1.2,
  /** Programmed web between nested parts, inches (Mack: 0.15"). */
  nestWebIn: 0.15,
  /** Unusable sheet length, inches: 96" sheet gives 95.5" usable (Mack). */
  sheetLengthMarginIn: 0.5,
  /** Unusable sheet width, inches: 48" sheet gives 47" usable (Mack). */
  sheetWidthMarginIn: 1.0,
  /** Purchased sheet assumed when the item number gives none (not read by the engine). */
  defaultSheetLengthIn: 96,
  defaultSheetWidthIn: 48,
  // MTL07 labor.
  /** Every labor cost is divided by (1 - this). Mack: 3%. */
  scrapFactor: 0.03,
  /** Run cost = cycle minutes / this x cell rate. Mack: 55. */
  productiveMinutesPerHour: 55,
  // MTL07 programming / NRE.
  /** Engineering rate for programming, $/hr (Mack MTL07: $172/hr). */
  engineeringRatePerHour: 172,
  /** Minutes to program each work cell (Mack: 5). */
  programMinutesPerWorkCell: 5,
  // Outside processing: Mack's convention, 20% markup then 11% freight.
  ospMarkupPct: 0.2,
  ospFreightPct: 0.11,
  // Legacy knobs, zero effect by default.
  scrapRecoveryPct: 0,
  scrapPricePerKg: 0,
  /** Zero on purpose: QA is quoted as the "Inspection + Utility" operation. */
  qaMinutesPerUnit: 0,
  packagingMinutesPerUnit: 0,
  shipmentsPerYearPerTier: 4,
  freightPerShipment: 0,
  packagingMaterialPerUnit: 0,
  // Legacy generic-model values, kept so old documents parse. The MTL07 model never applies them.
  variableOverheadPct: 0.15,
  fixedOverheadPct: 0.1,
  targetMarginPct: 0.2,
} as const;

/** kg/m^3. */
export const METALS_DENSITIES: Readonly<Record<string, number>> = {
  'Al 6061-T6': 2700,
  'Al 6061': 2700,
  'Al 5052': 2680,
  'Al 7075': 2810,
  'Aluminum 6061-T6': 2700,
  'Aluminum 6061': 2700,
  Aluminum: 2700,
  'CRS 1018': 7870,
  CRS: 7870,
  'Carbon Steel': 7870,
  'Mild Steel': 7870,
  A36: 7850,
  Steel: 7870,
  'SS 304': 8000,
  'SS 316': 8000,
  'SS 316L': 8000,
  'SS 430': 7700,
  'Stainless Steel 304': 8000,
  'Stainless Steel 316': 8000,
  'Stainless Steel': 8000,
  Brass: 8500,
  Bronze: 8800,
  Copper: 8960,
  Titanium: 4500,
  'Ti-6Al-4V': 4430,
  'Inconel 625': 8440,
  'Hastelloy C276': 8890,
};

export const METALS_DEFAULT_YIELD_FACTORS: Readonly<Record<MetalsStockForm, number>> = {
  Sheet: 0.85,
  Plate: 0.85,
  Bar: 0.9,
  Tube: 0.9,
  Angle: 0.9,
  Extrusion: 0.9,
  Casting: 0.85,
  Other: 0.8,
};

export const METALS_WORK_CELLS: readonly MetalsWorkCell[] = [
  { name: "Trumpf TC600L Punch Laser Combo", hourlyCellRate: 334, setUpCharge: 1253, setUpChargePerMin: 20.88, setUpTimeHours: 0.333, setUpCostAsPrinted: 6.95, sortOrder: 1 },
  { name: "Trumpf TC500R Punch", hourlyCellRate: 252, setUpCharge: 1253, setUpChargePerMin: 20.88, setUpTimeHours: 0.333, setUpCostAsPrinted: 6.95, sortOrder: 2 },
  { name: "Trumpf Tru Laser 2030 Coax", hourlyCellRate: 345, setUpCharge: 1606, setUpChargePerMin: 26.77, setUpTimeHours: 0.167, setUpCostAsPrinted: 4.47, sortOrder: 3 },
  { name: "Trumpf Tru Laser 2030 Fiber L72", hourlyCellRate: 355, setUpCharge: 1606, setUpChargePerMin: 26.77, setUpTimeHours: 0.167, setUpCostAsPrinted: 4.47, sortOrder: 4 },
  { name: "Trumpf Tru Laser 2030 Fiber L82", hourlyCellRate: 355, setUpCharge: 1606, setUpChargePerMin: 26.77, setUpTimeHours: 0.167, setUpCostAsPrinted: 4.47, sortOrder: 5 },
  { name: "Bystronic Xpert 250", hourlyCellRate: 129, setUpCharge: 629, setUpChargePerMin: 10.48, setUpTimeHours: 0.25, setUpCostAsPrinted: 2.62, sortOrder: 6 },
  { name: "Trumpf V85 CNC Press Brake", hourlyCellRate: 123, setUpCharge: 629, setUpChargePerMin: 10.48, setUpTimeHours: 0.25, setUpCostAsPrinted: 2.62, sortOrder: 7 },
  { name: "Trumpf V130 CNC Press Brake", hourlyCellRate: 123, setUpCharge: 629, setUpChargePerMin: 10.48, setUpTimeHours: 0.25, setUpCostAsPrinted: 2.62, sortOrder: 8 },
  { name: "Trumpf E18", hourlyCellRate: 123, setUpCharge: 629, setUpChargePerMin: 10.48, setUpTimeHours: 0.25, setUpCostAsPrinted: 2.62, sortOrder: 9 },
  { name: "Assembly", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.333, setUpCostAsPrinted: 1.98, sortOrder: 10 },
  { name: "Inspection + Utility", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.25, setUpCostAsPrinted: 1.49, sortOrder: 11 },
  { name: "Drilling / Tapping", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 12 },
  { name: "Manual Deburring", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 13 },
  { name: "Metal Finishing", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 14 },
  { name: "PEM Insertion", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 15 },
  { name: "Riveting", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 16 },
  { name: "Manual Roll Flattening", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 17 },
  { name: "Telesis Pin Marking", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 18 },
  { name: "Timesaver 3121", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 19 },
  { name: "Vibratory Deburring", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 20 },
  { name: "6060RS Turntable Blaster", hourlyCellRate: 81, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 21 },
  { name: "BB4K Basket Blaster", hourlyCellRate: 81, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 22 },
  { name: "Chamberlain's Manual Blaster", hourlyCellRate: 81, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.167, setUpCostAsPrinted: 0.99, sortOrder: 23 },
  { name: "Elumatic Extrusion", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.25, setUpCostAsPrinted: 1.49, sortOrder: 24 },
  { name: "MIG Welding", hourlyCellRate: 123, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.333, setUpCostAsPrinted: 1.98, sortOrder: 25 },
  { name: "TIG Welding", hourlyCellRate: 106, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.333, setUpCostAsPrinted: 1.98, sortOrder: 26 },
  { name: "Spot Welding", hourlyCellRate: 98, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 0.25, setUpCostAsPrinted: 1.49, sortOrder: 27 },
  { name: "Trumpf/Liton Tru Pulse 203", hourlyCellRate: 138, setUpCharge: 425, setUpChargePerMin: 7.08, setUpTimeHours: 0.333, setUpCostAsPrinted: 2.36, sortOrder: 28 },
  { name: "Trumpf/Litron HL 203P", hourlyCellRate: 138, setUpCharge: 425, setUpChargePerMin: 7.08, setUpTimeHours: 0.333, setUpCostAsPrinted: 2.36, sortOrder: 29 },
  { name: "Silk Screen", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 1, setUpCostAsPrinted: 5.95, sortOrder: 30 },
  { name: "Pad Printing", hourlyCellRate: 70, setUpCharge: 357, setUpChargePerMin: 5.95, setUpTimeHours: 1, setUpCostAsPrinted: 5.95, sortOrder: 31 },
];

export const METALS_MATERIAL_ITEMS: readonly MetalsMaterialItem[] = [
  { itemNumber: "SA0202048096", description: "SHEET,AL 5052-H32,26GA..020\"48X96", priceUsd: 65, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-09-10", sortOrder: 1 },
  { itemNumber: "SA0204048096", description: "SHEET, 5052-H32 ALU.040\" 4X8", priceUsd: 41.4, priceBasis: "twelveMonthAverage", purchaseCount: 2, lastPurchaseDate: "2024-12-09", sortOrder: 2 },
  { itemNumber: "SA0205048096", description: "SHEET, 5052-H32 ALU.050\" 48X96", priceUsd: 57.61, priceBasis: "sixMonthAverage", purchaseCount: 3, lastPurchaseDate: "2025-08-13", sortOrder: 3 },
  { itemNumber: "SA0205948096", description: "SHEET, 5052-H32 AL 14GA (.063)", priceUsd: 73.13, priceBasis: "sixMonthAverage", purchaseCount: 5, lastPurchaseDate: "2025-08-19", sortOrder: 4 },
  { itemNumber: "SA0208048096", description: "SHEET, 5052-H32 AL .O80\" 4X8", priceUsd: 92.08, priceBasis: "sixMonthAverage", purchaseCount: 2, lastPurchaseDate: "2025-07-30", sortOrder: 5 },
  { itemNumber: "SA0209048096", description: "SHEET, 5052-H32 AL .O90\" 4X8", priceUsd: 89.23, priceBasis: "twelveMonthAverage", purchaseCount: 3, lastPurchaseDate: "2025-02-13", sortOrder: 6 },
  { itemNumber: "SA0210048096", description: "SHT,ALUM,5052-H32,.100,48X96", priceUsd: 119.46, priceBasis: "sixMonthAverage", purchaseCount: 3, lastPurchaseDate: "2025-08-19", sortOrder: 7 },
  { itemNumber: "SA0212548096", description: "SHT,ALUM,5052-H32,.125,48X96", priceUsd: 145.27, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-04-10", sortOrder: 8 },
  { itemNumber: "SA0218848096", description: "5052-H32 ALUM., .188\" 48 X 96", priceUsd: 214.01, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-03-25", sortOrder: 9 },
  { itemNumber: "SA0225048096", description: "SHeet 5052-H32 AL .250 48 X 96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 10 },
  { itemNumber: "SA0306348096", description: "6061, ALUM., .063X48\"X96\"", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 11 },
  { itemNumber: "SA0308048096", description: "6061-T6, ALUM .080\" 48 X 96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 12 },
  { itemNumber: "SA0309048096", description: "SH, 6061-T6, ALUM,.090\" 48X96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 13 },
  { itemNumber: "SA0312548096", description: "6061-T6, ALUM .125\" 48 X 96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 14 },
  { itemNumber: "SA0318848096", description: "6061-T6, ALUM .188\" 48 X 96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 15 },
  { itemNumber: "SA0325048096", description: "6061-T6, ALUM., .250\" 48 X 96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 16 },
  { itemNumber: "SA0337548096", description: "SH, 6061-T6, ALUM, .375, 48X96", priceUsd: 575, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-01-31", sortOrder: 17 },
  { itemNumber: "SA0350048096", description: "SHEET, 6061-T6 AL, .500 X 48.5", priceUsd: 665.32, priceBasis: "twelveMonthAverage", purchaseCount: 3, lastPurchaseDate: "2024-11-26", sortOrder: 18 },
  { itemNumber: "SA0410048096", description: "SHT,ALUM,5052-H32,.100,48X96", priceUsd: 127.34, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-08-19", sortOrder: 19 },
  { itemNumber: "SA0606348096", description: "SHEET, .059 X 48\" X 96\"", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 20 },
  { itemNumber: "SA0606348120", description: "SHEET, .059 X 48\" X 120\"", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 21 },
  { itemNumber: "SA0612548096", description: "SHEET, .125 x 48\" x 96\",", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 22 },
  { itemNumber: "SA0612548120", description: "SHEET, .125 X 48\" X 120\"", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 23 },
  { itemNumber: "SA0612560120", description: ".125 AL 3003-H14,.125X60\"X120\"", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 24 },
  { itemNumber: "SA0725048096", description: "SHT,ALUM 7075-T6 2GA.,.250", priceUsd: 615, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-07-22", sortOrder: 25 },
  { itemNumber: "SAP603248096", description: "SHEET, 3003 H-14, HEXAGONAL", priceUsd: 173.3, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2024-11-15", sortOrder: 26 },
  { itemNumber: "SB0202448096", description: "SHEET, GALVANEALED, 24 GAUGE", priceUsd: 36.56, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-02-21", sortOrder: 27 },
  { itemNumber: "SB0203548096", description: "SHEET, GALVANEALED, 20 GAUGE", priceUsd: 33.43, priceBasis: "twelveMonthAverage", purchaseCount: 2, lastPurchaseDate: "2025-01-02", sortOrder: 28 },
  { itemNumber: "SB0204748096", description: "SHEET, GALVANEALED, 18 GAUGE", priceUsd: 49.67, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-08-14", sortOrder: 29 },
  { itemNumber: "SB0205948096", description: "SHEET, GALVANEALED, 16GAUGE", priceUsd: 57.08, priceBasis: "sixMonthAverage", purchaseCount: 6, lastPurchaseDate: "2025-08-13", sortOrder: 30 },
  { itemNumber: "SB0205960096", description: "SHEET, 16GA, GALVANNEALED,", priceUsd: 70.12, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-07-29", sortOrder: 31 },
  { itemNumber: "SB0205960120", description: "*OBS* SHEET, GALVANEALED, 16", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 32 },
  { itemNumber: "SB0207448096", description: "GALVANEALED, 14 GAUGE, 48 X 96", priceUsd: 70.26, priceBasis: "sixMonthAverage", purchaseCount: 4, lastPurchaseDate: "2025-08-13", sortOrder: 33 },
  { itemNumber: "SB0208948096", description: "SHEET, GALVANEALED, 13 GAUGE", priceUsd: 87.54, priceBasis: "sixMonthAverage", purchaseCount: 2, lastPurchaseDate: "2025-08-14", sortOrder: 34 },
  { itemNumber: "SB0210448096", description: "GALVANEALED, 12 GAUGE, 48 X 96", priceUsd: 100.77, priceBasis: "sixMonthAverage", purchaseCount: 2, lastPurchaseDate: "2025-09-04", sortOrder: 35 },
  { itemNumber: "SB0212548096", description: "GALVANEALED,11 GAUGE, 48 X 96", priceUsd: 91.58, priceBasis: "twelveMonthAverage", purchaseCount: 3, lastPurchaseDate: "2025-02-21", sortOrder: 36 },
  { itemNumber: "SB0213448096", description: "GALVANEALED, 10 GAUGE, 48 X 96", priceUsd: 124.88, priceBasis: "sixMonthAverage", purchaseCount: 2, lastPurchaseDate: "2025-07-18", sortOrder: 37 },
  { itemNumber: "SC0104748096", description: "SHEET,CRS,18GA,4X8,SLIGHT OIL", priceUsd: 46.6, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2024-10-29", sortOrder: 38 },
  { itemNumber: "SC0105948096", description: "SHEET,CRS,16GA,4X8,SLIGHT OIL", priceUsd: 51.45, priceBasis: "sixMonthAverage", purchaseCount: 5, lastPurchaseDate: "2025-07-30", sortOrder: 39 },
  { itemNumber: "SC0107448096", description: "SHEET,CRS,14GA,4X8,SLIGHT OIL", priceUsd: 63.99, priceBasis: "sixMonthAverage", purchaseCount: 2, lastPurchaseDate: "2025-08-19", sortOrder: 40 },
  { itemNumber: "SC0108948096", description: "SHEET,CRS,13GA,4X8,SLIGHT OIL", priceUsd: 75.21, priceBasis: "sixMonthAverage", purchaseCount: 5, lastPurchaseDate: "2025-08-07", sortOrder: 41 },
  { itemNumber: "SC0110448096", description: "SHEET,CRS,12GA,4X8,SLIGHT OIL", priceUsd: 95, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-08-13", sortOrder: 42 },
  { itemNumber: "SC0111948096", description: "SHEET,CRS,11GA,4X8,SLIGHT OIL", priceUsd: 105.86, priceBasis: "sixMonthAverage", purchaseCount: 4, lastPurchaseDate: "2025-08-29", sortOrder: 43 },
  { itemNumber: "SC0113448096", description: "SHEET,CRS,10GA..135\"48X96", priceUsd: 114.6, priceBasis: "sixMonthAverage", purchaseCount: 3, lastPurchaseDate: "2025-09-10", sortOrder: 44 },
  { itemNumber: "SC0115048096", description: "SHEET, HRPO, 9GA,SLIGHT OIL 48", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 45 },
  { itemNumber: "SCU102036096", description: "COPPER C1100 1/2 HARD, 36\"", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 46 },
  { itemNumber: "SCX1#1648096", description: "EXPANDED STEEL", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 47 },
  { itemNumber: "SG0507448096", description: "14 GA,GALVANIZED,G60,HOT DIPP.", priceUsd: 73.49, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-03-25", sortOrder: 48 },
  { itemNumber: "SS0102048096", description: "0.02 304 STAINLSS STEEL 48X96", priceUsd: 53.35, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-09-04", sortOrder: 49 },
  { itemNumber: "SS0102548096", description: "24 GA 304,SS,48X96 SHT (.025\")", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 50 },
  { itemNumber: "SS0103048096", description: "22GA, T304-2B, SS, 48X96 SHT", priceUsd: 74.06, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-09-04", sortOrder: 51 },
  { itemNumber: "SS0103548096", description: "SHT,STAINLESS T304-2B 20GA,.035,48X96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 52 },
  { itemNumber: "SS0104048096", description: "SS 304 2B .040\" GA 48\" X 96\"", priceUsd: 97, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-07-28", sortOrder: 53 },
  { itemNumber: "SS0104748096", description: "18 GA. T304-2B STAINLESS, NOVA", priceUsd: 110.45, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-01-10", sortOrder: 54 },
  { itemNumber: "SS0105948096", description: "16 GA. T304-2B STAINLESS", priceUsd: 139.14, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-08-07", sortOrder: 55 },
  { itemNumber: "SS0107448096", description: "14 GA. 304 STAINLESS STEEL", priceUsd: 176.01, priceBasis: "sixMonthAverage", purchaseCount: 2, lastPurchaseDate: "2025-08-07", sortOrder: 56 },
  { itemNumber: "SS0107448120", description: "SHEET, 14GA., SS", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 57 },
  { itemNumber: "SS0108948096", description: "13.GA T304-2B STAINLESS", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 58 },
  { itemNumber: "SS0110548096", description: "12 GA. T304-2B SS", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 59 },
  { itemNumber: "SS0112548096", description: "SHEET, 304SS, .125 X 48\" X 96\"", priceUsd: 254.82, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-06-09", sortOrder: 60 },
  { itemNumber: "SS0116448096", description: "SHEET,8GA,SS,T304-2B,48\"X96\"", priceUsd: 405.33, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2024-11-18", sortOrder: 61 },
  { itemNumber: "SS0118848096", description: "SHEET, 7GA, SS, T304-2B, 48X96", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 62 },
  { itemNumber: "SS0203548096", description: "SHT,20 GA 304 SST,PRE GRAINED", priceUsd: 92, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-08-07", sortOrder: 63 },
  { itemNumber: "SS0204748096", description: "18 GA. T304-2B STAINLESS, PVC", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 64 },
  { itemNumber: "SS0206348096", description: "17-4 SS  .063\" +\\- .002\" 48\"", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 65 },
  { itemNumber: "SS0207448096", description: ".074\" PVC COATED - 304 SS - #4", priceUsd: 188, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-07-22", sortOrder: 66 },
  { itemNumber: "SS0303012036", description: "301 STAINLESS STEEL SHIM", priceUsd: 64.81, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2024-11-13", sortOrder: 67 },
  { itemNumber: "SS0303648096", description: "20 GA. 316 STAINLESS 48 X 96", priceUsd: 127.88, priceBasis: "twelveMonthAverage", purchaseCount: 1, lastPurchaseDate: "2024-10-24", sortOrder: 68 },
  { itemNumber: "SS0501012024", description: ".010\" +/-.0015\",SS,1095 Spring", priceUsd: 39.88, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-06-05", sortOrder: 69 },
  { itemNumber: "SS0504048096", description: "SST 304 SERIES 320 GRAIN 48X96", priceUsd: 284, priceBasis: "sixMonthAverage", purchaseCount: 1, lastPurchaseDate: "2025-08-13", sortOrder: 70 },
  { itemNumber: "SS0507448096", description: "14GA .074\" THK 304 SST", priceUsd: null, priceBasis: "none", purchaseCount: 0, lastPurchaseDate: null, sortOrder: 71 },
];
