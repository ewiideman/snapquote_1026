// Public API of the Metals pricing engine.

export {
  priceMetalsLine,
  validateMetalsLine,
  isSheetCosted,
  metalsQuoteTotals,
  computeSheetUsage,
  resolveNestingParams,
  hardwareUnitCostAtQty,
  hardwareCostPerPart,
  toolingTotal,
  toolingShareOfPrice,
} from './engine.ts';
export type { MetalsNestingParams, MetalsSheetInput, MetalsSheetUsage } from './engine.ts';
export {
  findMetalsWorkCell,
  findMetalsMaterialItem,
  workCellSetupMinutes,
  metalsItemPriceNote,
  deriveMetalsItemAttributes,
  metalsItemSheetSpec,
  metalsMaterialDensity,
} from './catalog.ts';
export type { MetalsItemAttributes, MetalsSheetSpec } from './catalog.ts';
export { ospCostPerPart, ospRatesFromSettings, isOspPending } from './osp.ts';
export type { OspRates } from './osp.ts';
export {
  parseMetalsCalculationSettings,
  flattenMetalsSettingsRecord,
  resolveMetalsNumber,
  effectiveYieldFactor,
  defaultYieldFactor,
} from './settings.ts';
export {
  METALS_DEFAULTS,
  METALS_DENSITIES,
  METALS_DEFAULT_YIELD_FACTORS,
  METALS_WORK_CELLS,
  METALS_MATERIAL_ITEMS,
  METALS_PRICE_WINDOW,
} from './seed.ts';
export type * from './types.ts';
