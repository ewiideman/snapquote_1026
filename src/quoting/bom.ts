// Parts proposed from a customer's spreadsheet (a BOM or a parts list). Pure.
//
// The header row is found by its words, within the first 20 rows of each sheet, and the sheet whose
// header names the most known columns is used. Only part number, revision, description and quantity
// per are taken as fields; material, notes and level go into the line's notes, word for word.
// A row with neither part number nor description is skipped. Nothing is guessed about who prices a part.

export interface ProposedLine {
  partNumber: string;
  revision: string;
  description: string;
  qtyPer: number;
  notes: string;
}

export interface BomResult {
  sheet: string | null;
  headerRow: number | null;
  lines: ProposedLine[];
  /** Why nothing was taken, when nothing was. */
  problem: string | null;
}

type Field = 'partNumber' | 'revision' | 'description' | 'qtyPer' | 'material' | 'notes' | 'level';

// Each pattern carries a strength: a column headed "Part Number" beats one headed "Item Number", which
// beats a bare "Item" -- usually the BOM's line or find number, used as the part number only when the
// sheet has nothing better.
const FIELD_PATTERNS: [Field, RegExp, number][] = [
  ['partNumber', /^(customer\s*|mfr\.?\s*|manufacturer\s*)?(part|component|dwg|drawing)\s*(no\.?|num(ber)?|#|id)?$|^p\/?n$|^mpn$/, 3],
  ['partNumber', /^item\s*(no\.?|num(ber)?|#|id)$/, 2],
  ['partNumber', /^item$/, 1],
  ['revision', /^rev(\.|ision)?(\s*level)?$/, 3],
  ['description', /^(part\s*|item\s*)?(desc(\.|ription)?|name|title)$/, 3],
  ['qtyPer', /^(qty|quantity)(\s*(per|\/)\s*(assy|assembly|unit|ea))?\.?$|^(qty|quantity)\s*per$|^usage$|^per$/, 3],
  ['material', /^(material|matl|mat'?l|raw material|resin|alloy)$/, 3],
  ['notes', /^(notes?|comments?|remarks?)$/, 3],
  ['level', /^(bom\s*)?level$|^lvl$/, 3],
];

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function headerFields(row: readonly unknown[]): Map<Field, number> {
  const best = new Map<Field, { col: number; strength: number }>();
  row.forEach((cell, i) => {
    const text = norm(cell);
    if (!text) return;
    const hit = FIELD_PATTERNS.find(([, re]) => re.test(text));
    if (!hit) return;
    const [field, , strength] = hit;
    const prior = best.get(field);
    if (!prior || strength > prior.strength) best.set(field, { col: i, strength });
  });
  return new Map([...best].map(([f, b]) => [f, b.col]));
}

const cellText = (row: readonly unknown[], i: number | undefined): string => (i === undefined ? '' : String(row[i] ?? '').trim());

export function proposeLines(sheets: readonly { name: string; rows: readonly (readonly unknown[])[] }[]): BomResult {
  let best: { sheet: string; headerRow: number; fields: Map<Field, number>; rows: readonly (readonly unknown[])[] } | null = null;
  for (const s of sheets) {
    s.rows.slice(0, 20).forEach((row, r) => {
      const fields = headerFields(row);
      if (!fields.has('partNumber') && !fields.has('description')) return;
      if (!best || fields.size > best.fields.size) best = { sheet: s.name, headerRow: r, fields, rows: s.rows };
    });
  }
  if (!best) return { sheet: null, headerRow: null, lines: [], problem: 'No column headed part number or description was found in the first 20 rows.' };
  const { sheet, headerRow, fields, rows } = best as { sheet: string; headerRow: number; fields: Map<Field, number>; rows: readonly (readonly unknown[])[] };
  const lines: ProposedLine[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const partNumber = cellText(row, fields.get('partNumber'));
    const description = cellText(row, fields.get('description'));
    if (!partNumber && !description) continue;
    const qtyRaw = cellText(row, fields.get('qtyPer')).replace(/,/g, '');
    const qty = Number(qtyRaw);
    const notes = [
      fields.has('level') && cellText(row, fields.get('level')) ? `Level ${cellText(row, fields.get('level'))}` : '',
      cellText(row, fields.get('material')) ? `Material: ${cellText(row, fields.get('material'))}` : '',
      qtyRaw && !(qty > 0) ? `Quantity per in the file: "${qtyRaw}"` : '',
      cellText(row, fields.get('notes')),
    ].filter(Boolean).join('. ');
    lines.push({ partNumber, revision: cellText(row, fields.get('revision')), description, qtyPer: qty > 0 ? qty : 1, notes });
  }
  return { sheet, headerRow, lines, problem: lines.length ? null : 'The header was found but no rows below it name a part.' };
}
