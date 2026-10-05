// Lookups over Metals reference data: work cells, sheet-stock items, alloy densities.
// Ported from SnapQuote 0626 src/constants/metalsFacilityRates.ts, metalsMaterialItems.ts
// and metalsReferenceData.ts. Lookups take the catalog as an argument (no module state).

import { METALS_DENSITIES, METALS_PRICE_WINDOW } from './seed.ts';
import type { MetalsCatalog, MetalsMaterialItem, MetalsWorkCell } from './types.ts';

const MM_PER_IN = 25.4;

/** Work cell by its exact rate-sheet name; undefined rather than a default. */
export function findMetalsWorkCell(
  catalog: Pick<MetalsCatalog, 'workCells'>,
  name: string | null | undefined,
): MetalsWorkCell | undefined {
  if (!name) return undefined;
  return catalog.workCells.find((c) => c.name === name);
}

/** Standard setup in minutes, from the sheet's fraction of an hour, rounded to 2 dp (0.167 h gives 10.02). */
export function workCellSetupMinutes(cell: MetalsWorkCell): number {
  return Math.round(cell.setUpTimeHours * 60 * 100) / 100;
}

/** Item by number, trimmed and case-insensitive; undefined when not cataloged. */
export function findMetalsMaterialItem(
  catalog: Pick<MetalsCatalog, 'materialItems'>,
  itemNumber: string | null | undefined,
): MetalsMaterialItem | undefined {
  if (!itemNumber) return undefined;
  const key = itemNumber.trim().toUpperCase();
  return catalog.materialItems.find((i) => i.itemNumber.toUpperCase() === key);
}

/** Plain-English provenance for an item's price. */
export function metalsItemPriceNote(item: MetalsMaterialItem): string {
  if (item.priceUsd === null || item.priceBasis === 'none') {
    return 'No purchase in the XA export — price must be entered by hand.';
  }
  const buys = `${item.purchaseCount} purchase${item.purchaseCount === 1 ? '' : 's'}`;
  if (item.priceBasis === 'sixMonthAverage') {
    return `Average of ${buys}, ${METALS_PRICE_WINDOW.start} to ${METALS_PRICE_WINDOW.end}.`;
  }
  return `No purchase in the last six months of the export — average of ${buys} across the full export, most recently ${item.lastPurchaseDate}.`;
}

/** Alloy fingerprints in the description, checked in order; first hit wins. kg/m^3. */
const ALLOY_BY_DESCRIPTION: { match: RegExp; alloy: string; density: number }[] = [
  { match: /5052/, alloy: 'Al 5052-H32', density: 2680 },
  { match: /6061/, alloy: 'Al 6061-T6', density: 2700 },
  { match: /3003/, alloy: 'Al 3003-H14', density: 2730 },
  { match: /17-4/, alloy: 'SS 17-4', density: 7800 },
  { match: /\b301\b/, alloy: 'SS 301', density: 7900 },
  { match: /1095/, alloy: 'Steel 1095 spring', density: 7850 },
  { match: /316/, alloy: 'SS 316', density: 8000 },
  { match: /304|T304|SST/, alloy: 'SS 304', density: 8000 },
  { match: /COPPER|C1100/, alloy: 'Copper C1100', density: 8960 },
  { match: /GALVANN?EALED|GALVANIZED/, alloy: 'Galvanealed steel', density: 7870 },
  { match: /CRS|CARBON|HRPO|CRCQ/, alloy: 'CRS', density: 7870 },
];

/** Fallback by item-number prefix when the description names no alloy. */
const ALLOY_BY_PREFIX: { match: RegExp; alloy: string; density: number }[] = [
  { match: /^SCU/, alloy: 'Copper C1100', density: 8960 },
  { match: /^SA/, alloy: 'Aluminum', density: 2700 },
  { match: /^SB/, alloy: 'Galvanealed steel', density: 7870 },
  { match: /^SG/, alloy: 'Galvanized steel', density: 7870 },
  { match: /^SC/, alloy: 'CRS', density: 7870 },
  { match: /^SS/, alloy: 'Stainless steel', density: 8000 },
];

export type MetalsItemAttributes = {
  thicknessMm: number;
  sheetWidthMm: number;
  sheetLengthMm: number;
  alloy: string;
  densityKgPerM3: number;
};

/**
 * Decode an item number: SA0205048096 is aluminum (A), family 02, .050" thick, 48" x 96".
 * The last eight digits are thickness (thousandths), width (2 digits), length (3 digits).
 * Undefined when it does not fit (e.g. SCX1#1648096, expanded steel). A stopgap until XA
 * supplies these as fields.
 */
export function deriveMetalsItemAttributes(
  itemNumber: string | null | undefined,
  description?: string,
): MetalsItemAttributes | undefined {
  if (!itemNumber) return undefined;
  const m = itemNumber.trim().toUpperCase().match(/^(.*?)(\d{3})(\d{2})(\d{3})$/);
  if (!m) return undefined;
  const [, prefix = '', thou = '', width = '', length = ''] = m;
  const thicknessMm = (parseInt(thou, 10) / 1000) * MM_PER_IN;
  const sheetWidthMm = parseInt(width, 10) * MM_PER_IN;
  const sheetLengthMm = parseInt(length, 10) * MM_PER_IN;
  if (!(thicknessMm > 0) || !(sheetWidthMm > 0) || !(sheetLengthMm > 0)) return undefined;

  const desc = (description ?? '').toUpperCase();
  const resolved =
    ALLOY_BY_DESCRIPTION.find((a) => a.match.test(desc)) ?? ALLOY_BY_PREFIX.find((a) => a.match.test(prefix));
  if (!resolved) return undefined;
  return { thicknessMm, sheetWidthMm, sheetLengthMm, alloy: resolved.alloy, densityKgPerM3: resolved.density };
}

export type MetalsSheetSpec = {
  priceUsd: number;
  widthMm: number;
  lengthMm: number;
  massKg: number;
  /** Sheet price / sheet mass. */
  pricePerKg: number;
};

/** The sheet behind a catalog item; undefined when unpriced or not decodable. */
export function metalsItemSheetSpec(item: MetalsMaterialItem | undefined): MetalsSheetSpec | undefined {
  if (!item || item.priceUsd === null || !(item.priceUsd > 0)) return undefined;
  const attrs = deriveMetalsItemAttributes(item.itemNumber, item.description);
  if (!attrs) return undefined;
  const massKg =
    (attrs.thicknessMm / 1000) * (attrs.sheetWidthMm / 1000) * (attrs.sheetLengthMm / 1000) * attrs.densityKgPerM3;
  if (!(massKg > 0)) return undefined;
  return {
    priceUsd: item.priceUsd,
    widthMm: attrs.sheetWidthMm,
    lengthMm: attrs.sheetLengthMm,
    massKg,
    pricePerKg: item.priceUsd / massKg,
  };
}

/**
 * Density for an alloy name: exact match, then fuzzy family match, then steel.
 * `known` is false when it fell back to steel (the original logged a console warning).
 */
export function metalsMaterialDensity(material: string): { densityKgPerM3: number; known: boolean } {
  const exact = METALS_DENSITIES[material];
  if (exact) return { densityKgPerM3: exact, known: true };
  const lower = material.toLowerCase();
  const family = (name: string): { densityKgPerM3: number; known: boolean } => ({
    densityKgPerM3: METALS_DENSITIES[name] ?? 7870,
    known: true,
  });
  if (lower.includes('aluminum') || lower.includes('al ')) return family('Aluminum');
  if (lower.includes('stainless') || lower.includes('ss ')) return family('Stainless Steel');
  if (lower.includes('steel') || lower.includes('crs')) return family('Steel');
  if (lower.includes('brass')) return family('Brass');
  if (lower.includes('copper')) return family('Copper');
  if (lower.includes('titanium') || lower.includes('ti-')) return family('Titanium');
  return { densityKgPerM3: METALS_DENSITIES['Steel'] ?? 7870, known: false };
}
