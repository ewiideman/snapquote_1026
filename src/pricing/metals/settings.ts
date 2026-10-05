// Org-wide Metals calculation settings: parsing the stored JSON document and resolving
// a value by precedence (line, then settings, then METALS_DEFAULTS).
// Ported from SnapQuote 0626 src/utils/metalsCalculationSettings.ts (network code dropped).

import { METALS_DEFAULT_YIELD_FACTORS } from './seed.ts';
import type { MetalsCalculationSettings, MetalsStockForm } from './types.ts';

const YIELD_FORMS = Object.keys(METALS_DEFAULT_YIELD_FACTORS) as MetalsStockForm[];

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Accepts 0-1 or 0-100; returns a decimal or undefined. Note: a 1-100 value is clamped to [0, 1], not to maxAsOne. */
function normalizeRatio(raw: unknown, maxAsOne = 1): number | undefined {
  if (!isFiniteNumber(raw)) return undefined;
  if (raw < 0) return undefined;
  if (raw > 1 && raw <= 100) return clamp(raw / 100, 0, 1);
  if (raw > 100) return undefined;
  return clamp(raw, 0, maxAsOne);
}

function normalizeNonNegative(raw: unknown, hi?: number): number | undefined {
  if (!isFiniteNumber(raw) || raw < 0) return undefined;
  return hi !== undefined ? clamp(raw, 0, hi) : raw;
}

function normalizeYieldFactors(raw: unknown): Partial<Record<MetalsStockForm, number>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<MetalsStockForm, number>> = {};
  let any = false;
  for (const key of YIELD_FORMS) {
    let v: unknown;
    for (const alias of [key, key.toLowerCase(), key.toUpperCase()]) {
      if (alias in o) {
        v = o[alias];
        break;
      }
    }
    if (v === undefined) continue;
    if (!isFiniteNumber(v) || v <= 0 || v > 1) continue;
    out[key] = v;
    any = true;
  }
  return any ? out : undefined;
}

/** Merge a nested METALS_DEFAULTS object with top-level keys; top-level wins. */
export function flattenMetalsSettingsRecord(settings: unknown): Record<string, unknown> {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const s = settings as Record<string, unknown>;
  const nested = s['METALS_DEFAULTS'] ?? s['metals_defaults'] ?? s['metalsDefaults'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>), ...s };
  }
  return s;
}

/**
 * Parse and validate the stored settings document (camelCase or snake_case keys).
 * Invalid or out-of-range numbers are omitted, so the default applies. Null for a non-object.
 */
export function parseMetalsCalculationSettings(settings: unknown): MetalsCalculationSettings | null {
  if (settings === null || settings === undefined) return null;
  if (typeof settings !== 'object' || Array.isArray(settings)) return null;
  const s = flattenMetalsSettingsRecord(settings);
  const pick = (camel: string, snake: string): unknown => s[camel] ?? s[snake];

  const yieldFactors =
    normalizeYieldFactors(pick('yieldFactors', 'yield_factors')) ??
    normalizeYieldFactors(s['defaultYieldFactors']);

  // materialMarkup is a multiplier: [1, 10] as is; (10, 1000] read as a percentage; (0, 1) as a fraction.
  const markupRaw = pick('materialMarkup', 'material_markup');
  let materialMarkup: number | undefined;
  if (isFiniteNumber(markupRaw) && markupRaw > 0) {
    materialMarkup =
      markupRaw >= 1 && markupRaw <= 10
        ? markupRaw
        : markupRaw > 10 && markupRaw <= 1000
          ? 1 + markupRaw / 100
          : markupRaw < 1
            ? 1 + markupRaw
            : undefined;
  }

  const productiveRaw = pick('productiveMinutesPerHour', 'productive_minutes_per_hour');
  const productiveMinutesPerHour =
    isFiniteNumber(productiveRaw) && productiveRaw > 0 && productiveRaw <= 60 ? productiveRaw : undefined;

  const candidates: MetalsCalculationSettings = {
    materialMarkup,
    nestWebIn: normalizeNonNegative(pick('nestWebIn', 'nest_web_in'), 5),
    sheetLengthMarginIn: normalizeNonNegative(pick('sheetLengthMarginIn', 'sheet_length_margin_in'), 24),
    sheetWidthMarginIn: normalizeNonNegative(pick('sheetWidthMarginIn', 'sheet_width_margin_in'), 24),
    scrapFactor: normalizeRatio(pick('scrapFactor', 'scrap_factor'), 0.5),
    productiveMinutesPerHour,
    engineeringRatePerHour: normalizeNonNegative(pick('engineeringRatePerHour', 'engineering_rate_per_hour'), 10000),
    programMinutesPerWorkCell: normalizeNonNegative(pick('programMinutesPerWorkCell', 'program_minutes_per_work_cell'), 1e4),
    scrapRecoveryPct: normalizeRatio(pick('scrapRecoveryPct', 'scrap_recovery_pct')),
    scrapPricePerKg: normalizeNonNegative(pick('scrapPricePerKg', 'scrap_price_per_kg')),
    variableOverheadPct: normalizeRatio(pick('variableOverheadPct', 'variable_overhead_pct')),
    fixedOverheadPct: normalizeRatio(pick('fixedOverheadPct', 'fixed_overhead_pct')),
    targetMarginPct: normalizeRatio(pick('targetMarginPct', 'target_margin_pct'), 0.95),
    qaMinutesPerUnit: normalizeNonNegative(pick('qaMinutesPerUnit', 'qa_minutes_per_unit'), 1e6),
    packagingMinutesPerUnit: normalizeNonNegative(pick('packagingMinutesPerUnit', 'packaging_minutes_per_unit'), 1e6),
    shipmentsPerYearPerTier: normalizeNonNegative(pick('shipmentsPerYearPerTier', 'shipments_per_year_per_tier'), 1e6),
    freightPerShipment: normalizeNonNegative(pick('freightPerShipment', 'freight_per_shipment')),
    packagingMaterialPerUnit: normalizeNonNegative(pick('packagingMaterialPerUnit', 'packaging_material_per_unit')),
    ospMarkupPct: normalizeRatio(pick('ospMarkupPct', 'osp_markup_pct')),
    ospFreightPct: normalizeRatio(pick('ospFreightPct', 'osp_freight_pct')),
  };

  const out: MetalsCalculationSettings = {};
  if (yieldFactors && Object.keys(yieldFactors).length > 0) out.yieldFactors = yieldFactors;
  for (const [key, value] of Object.entries(candidates)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Line value wins when it is a finite number, then the settings value, then the default. */
export function resolveMetalsNumber(
  lineValue: number | null | undefined,
  settingsValue: number | undefined,
  fallback: number,
): number {
  if (lineValue !== null && lineValue !== undefined) {
    const q = Number(lineValue);
    if (Number.isFinite(q)) return q;
  }
  if (settingsValue !== undefined && Number.isFinite(settingsValue)) return settingsValue;
  return fallback;
}

export function defaultYieldFactor(stockForm: string): number {
  return (METALS_DEFAULT_YIELD_FACTORS as Record<string, number>)[stockForm] || METALS_DEFAULT_YIELD_FACTORS.Other;
}

/** Line yield (0 < y <= 1), then the settings yield for the form, then the default for the form. */
export function effectiveYieldFactor(
  stockForm: string | undefined,
  lineYield: number | null | undefined,
  settings: MetalsCalculationSettings | null | undefined,
): number {
  if (lineYield !== null && lineYield !== undefined) {
    const q = Number(lineYield);
    if (Number.isFinite(q) && q > 0 && q <= 1) return q;
  }
  const form = stockForm || 'Other';
  const fromSettings = settings?.yieldFactors?.[form as MetalsStockForm];
  if (typeof fromSettings === 'number' && Number.isFinite(fromSettings) && fromSettings > 0 && fromSettings <= 1) {
    return fromSettings;
  }
  return defaultYieldFactor(form);
}
