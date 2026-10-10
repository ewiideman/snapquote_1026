// Parts proposed from a customer's spreadsheet (a BOM or a parts list). Pure.
//
// The header row is found by its words within the first 20 rows of each sheet; two rows are read as one
// when the headings are stacked ("Part" over "No."). The header with parts under it that names the most
// known columns is used, on whichever sheet it is; a title block ("Customer P/N | 4100-0001 | Rev | C")
// is not a header. Reading starts at the first table on that sheet with part numbers under it (purchased
// parts above fabricated ones), and each later table with its own header is read through its own
// columns; a block beside the table (revision history, tooling) does not interrupt it. Only part number,
// revision, description and quantity per are taken as fields; material, notes and level go into the
// line's notes, word for word. A row with neither part number nor description is skipped, and so are a
// sum line (TOTAL, Subtotal, Excel's "<group> Total"), a repeat of the header and a banner merged across
// the table. Charge rows (Tooling, NRE, Freight) are kept: they say what the customer asked for. Nothing
// is guessed about who prices a part.

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

// Each heading is given a field and a strength. Part number:
// - 3.25: a component's number beside its parent's: "Component P/N", "Child Part", "Member Item", "MtlPartNum";
// - 3: "Part Number", "Part No.", "P/N", "PN#", "P.N.", "Component", "Customer Part Number";
// - 2.9: "Drawing No.", so a Part Number column wins wherever it is; a bare "Part" (1.25 in an electrical
//   BOM when its values are component values: 10K, 0.1uF);
// - 2.75: the customer's by its word: "Cust. P/N", "Buyer P/N", "OEM P/N", "Our Part No.", "CPN"; and
//   "Number" in a PLM export (one that also has a Version or State column);
// - 2.6: "Item", "Item No.", "Item Number", "Item ID", unless its values are mostly find numbers counting up
//   from 100 or less (1, 2, 1.1, 10, 2A); an Item Number beside the sheet's own find or line column never is;
// - 2.5: the manufacturer's: "Mfr P/N", "Manufacturer Part Number", "MPN";
// - 1.75: any other name before P/N or Item #, as a customer's own form heads its number ("KPD P/N",
//   "Boston Scientific P/N", "Bruker Item #"), so it is used when nothing above is there;
// - 1.5: an approved or preferred manufacturer's; 1: "No.", unless its values are find numbers.
// A heading naming another part or party is never a part number: a parent or assembly, a distributor or
// vendor, a substitute or old number, material, tooling or packaging, "Your P/N", "Mack P/N"; nor is a
// board's or harness's number ("CCA P/N"), nor a column holding a title block's labels.
// The strongest part-number column with values is used, except that a manufacturer's or drawing number
// gives way to a lower one (1.75 or more) filled on as many rows, mostly with different values that are
// numbers, and on most of the rows it is (a customer's numbering covers made and bought parts and each
// dash number; a parent repeats down the rows). Find numbers are used only where nothing else tells the
// rows apart: no part-number column and descriptions blank or repeated under one parent. An electrical
// BOM's Part holding values, when not the part number, describes the line if nothing else does.
// Revision: "Part Rev", "Component Rev", "Item Rev" (3.25); "Rev", "Revision", "Rev Level", "Rev #" (3);
// "Dwg Rev", "Customer Rev" (2.75); another word before Rev (1.75), unless it names another document or
// part ("BOM Rev", "From Rev"); and in a PLM export, "Version" (2), read as revision.iteration ("C.1" is
// revision C) and kept in the notes; never a board's, harness's or cable's ("Board Rev"). Other fields:
// the strongest column with values.
const NUM = String.raw`(no\.?|nbr\.?|num(ber|\.)?|#|id)`;
const PN = String.raw`(p\/?n\.?\s*#?|p\.\s*n\.?|p\/no\.?|part\s*${NUM})`;
const REV = String.raw`rev(\.|ision)?\s*(level|lvl\.?|letter|${NUM})?`;
const WORD = String.raw`[\p{Ll}\d][\p{Ll}\d&'’.-]{0,20}`;
const COMPONENT_PN = new RegExp(String.raw`^(component|comp\.?|child|member|mtl)\s*(item|part)\s*(${NUM}|p\/?n)?$|^(component|child)\s*(${NUM}|p\/?n)$`);
const PART_PN = new RegExp(String.raw`^((customer|cust\.?)\s*)?(part|component)\s*(${NUM}|p\/?n)?$|^${PN}$`);
const DRAWING_PN = new RegExp(String.raw`^((customer|cust\.?)\s*)?(dwg|drawing)\s*(${NUM}|p\/?n)?$`);
const CUSTOMER_PN = new RegExp(String.raw`^(cpn|company\s*${PN}|([a-z]+\s+)?12\s*nc)$`);
const NAMED_PN = new RegExp(String.raw`^(${WORD}(\s+(&\s+)?${WORD}){0,2})\s+${PN}$`, 'u');
// The customer's number as its ERP calls the part an item: "Bruker Item #", "Hologic Item No." (never the
// sheet's own find or line column, "Line Item #").
const NAMED_ITEM = new RegExp(String.raw`^(${WORD}(\s+(&\s+)?${WORD}){0,2})\s+item\s*${NUM}$`, 'u');
const MFR_PN = /^((approved|preferred)\s+)?(mfr|mfg|mfgr|manuf|manufacturer)('?s|\.)?\s*(part|#)$|^mpn$/;
const ITEM_PN = new RegExp(String.raw`^((customer|cust\.?)\s*)?item\s*${NUM}?$`);
const BARE_REV = new RegExp(String.raw`^${REV}$`);
const NAMED_REV = new RegExp(String.raw`^(${WORD})\s+${REV}$`, 'u');
const DESCRIPTION = /^((part|item|component|object)\s*)?(desc(\.|ription)?|name|title)$|^short text$|^nomenclature( (or|\/) description)?$|^part name\s*\/\s*description$/;
const QTY_PER = /^(qty|quantity)(\s*(per|\/)\s*(assy|assembly|unit|ea))?\.?$|^(qty|quantity)\s*per$|^usage$|^per$/;

const CUSTOMER_WORDS = new Set(['customer', 'cust', 'buyer', 'oem', 'client', 'purchaser', 'our', 'internal']);
const MAKER_WORDS = new Set(['mfr', 'mfg', 'mfgr', 'manuf', 'manufacturer']);
const COMPONENT_REV_WORDS = new Set(['part', 'component', 'comp', 'child', 'item']);
const PART_REV_WORDS = new Set([...CUSTOMER_WORDS, 'dwg', 'drawing', 'print', 'current', 'released', 'latest', 'new', 'to', 'is']);
const NOT_THIS_PART = new Set(`parent assy asm asy assm assembly subassy subassembly sub top next nha higher used where model product fg finished bom end
  mfr mfg mfgr manuf manufacturer vendor vend vndr supplier suppl supp seller bidder quoted offered source distributor distr distrib dist
  digikey digi dk mouser newark arrow avnet farnell rs tti lcsc jlc jlcpcb mcmaster carr grainger fastenal msc allied future sager tme heilind element14
  approved preferred aml avl substitute subs alt alternate alternative replacement replaces replaced supersedes superseded prev previous prior old legacy
  obsolete former was other secondary second backup option optional equiv equivalent competitor cross xref x ref reference mating mold tool tooling die kit
  material mat matl mtl resin colorant color colour masterbatch pigment stock raw blank bar sheet coil plate casting forging insert packaging pkg label
  box carton bag fixture gage gauge your mack spare spec doc from firmware fw sw software pcb pcba eco ecn schematic program 2d 3d
  waytek bossard galco endries optimas wurth bisco onlinecomponents verical zoro uline`.split(/\s+/));

/** A word before P/N or Rev, as words: "Assy." -> [assy], "Supplier's" -> [supplier], "Top-Level" -> [top-level, top, level]. */
function prefixWords(word: string): string[] {
  const w = word.replace(/['’]s?$|\.$/g, '').replace(/['’.]/g, '');
  return [w, ...w.split('-').filter(Boolean)];
}
const refused = (word: string) => prefixWords(word).some((w) => NOT_THIS_PART.has(w));
const first = (word: string) => prefixWords(word)[0] ?? '';

/** What the other headings in the row say about this one. */
interface Context { plm: boolean; electrical: boolean; sap: boolean }
const NO_CONTEXT: Context = { plm: false, electrical: false, sap: false };
/**
 * `item`: may hold find numbers; `mfr`: a manufacturer's number, which made parts do not have; `value`: an
 * electrical BOM's Part, which may hold the component's value (10K, 0.1uF) rather than a number.
 */
type Hit = { field: Field; strength: number; kind?: 'item' | 'mfr' | 'value' | 'dwg' };

function classify(text: string, ctx: Context): Hit | null {
  let m: RegExpExecArray | null;
  const pn = (strength: number, kind?: Hit['kind']): Hit => (kind ? { field: 'partNumber', strength, kind } : { field: 'partNumber', strength });
  const rev = (strength: number): Hit => ({ field: 'revision', strength });
  if (COMPONENT_PN.test(text)) return pn(3.25);
  if (text === 'part') return ctx.electrical ? pn(2.9, 'value') : pn(2.9);
  if (PART_PN.test(text)) return pn(3);
  if (DRAWING_PN.test(text)) return pn(2.9, 'dwg');
  if (CUSTOMER_PN.test(text)) return pn(2.75);
  if ((m = NAMED_PN.exec(text))) {
    const words = (m[1] ?? '').split(/\s+/).filter((w) => w !== '&');
    const approved = words.length === 2 && /^(approved|preferred)$/.test(first(words[0] ?? ''));
    if ((words.length === 1 || approved) && MAKER_WORDS.has(first(words[words.length - 1] ?? ''))) return pn(approved ? 1.5 : 2.5, 'mfr');
    if (words.some(refused)) return null;
    return pn(CUSTOMER_WORDS.has(first(words[0] ?? '')) ? 2.75 : 1.75);
  }
  if (text === 'number' && ctx.plm) return pn(2.75);
  if ((m = MFR_PN.exec(text))) return pn(m[1] ? 1.5 : 2.5, 'mfr');
  if (ITEM_PN.test(text)) return pn(2.6, 'item');
  if ((m = NAMED_ITEM.exec(text)) && !FIND_HEADING.test(text)) {
    const words = (m[1] ?? '').split(/\s+/).filter((w) => w !== '&');
    if (words.some(refused) || words.some((w) => /^(line|find|po|order|quote|rfq|sales|catalog|stock)$/.test(first(w)))) return null;
    return pn(CUSTOMER_WORDS.has(first(words[0] ?? '')) ? 2.75 : 1.75, 'item');
  }
  if (text === 'no.') return pn(1, 'item');
  if (text === 'material' && ctx.sap) return pn(2.9);
  if (BARE_REV.test(text)) return rev(3);
  if ((m = NAMED_REV.exec(text))) {
    const word = m[1] ?? '';
    if (COMPONENT_REV_WORDS.has(first(word))) return rev(3.25);
    if (PART_REV_WORDS.has(first(word))) return rev(2.75);
    return refused(word) ? null : rev(1.75);
  }
  if (/^(version|ver\.?)$/.test(text)) return ctx.plm ? rev(2) : null;
  if (DESCRIPTION.test(text)) return { field: 'description', strength: 3 };
  if (QTY_PER.test(text)) return { field: 'qtyPer', strength: 3 };
  if (/^(material|matl|mat'?l|raw material|resin|alloy)$/.test(text)) return { field: 'material', strength: 3 };
  if (/^(notes?|comments?|remarks?)$/.test(text)) return { field: 'notes', strength: 3 };
  if (/^(bom\s*)?level$|^lvl$/.test(text)) return { field: 'level', strength: 3 };
  return null;
}

/** A heading with a trailing parenthetical: "Part Number (Customer)" is the customer's part number, "Qty (per assy)" the quantity per. */
function classifyHeading(text: string, ctx: Context): Hit | null {
  const hit = classify(text, ctx);
  const m = hit ? null : /^(.*\S)\s*\(([^()]+)\)$/.exec(text);
  if (!m) return hit;
  const head = m[1] ?? '', inner = m[2] ?? '';
  const base = classify(head, ctx);
  // "P/N (Supplier)" is the supplier's number, never the part's.
  if ((base?.field === 'partNumber' || base?.field === 'revision') && inner.split(/\s+/).some(refused)) return null;
  const swapped = classify(`${inner} ${head}`, ctx) ?? classify(`${head} ${inner}`, ctx);
  if (swapped) return swapped;
  // "Qty (EAU)", "Qty (Proto)": another quantity, not the quantity per.
  if (base?.field === 'qtyPer' && !/^(per|each|ea|pcs?|pieces|units?|assy|assembly)\b/.test(inner)) return null;
  return base;
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** A heading as words: "Part_Number *" -> "part number", "Part No:" -> "part no", "Customer P/N (required)" -> "customer p/n". */
const heading = (v: unknown): string => norm(v)
  .replace(/([a-z])[-_]+(?=[a-z])/g, '$1 ')
  .replace(/\s*\((required|req'?d|mandatory|optional|if (any|known|applicable|available))\)/g, '')
  .replace(/^[\s*]+|[\s:*]+$/g, '');

type Candidate = { col: number; strength: number; kind?: Hit['kind'] };
const NO_FIELDS = new Map<Field, Candidate[]>();

/** Each column's heading as classified beside the row's other headings. */
function headingHits(cells: readonly unknown[]): (Hit | null)[] {
  const texts = cells.map(heading);
  const ctx: Context = {
    // A PLM export: a "Number" column beside a "Version" or lifecycle "State" column.
    plm: texts.includes('number') && texts.some((t) => /^(version|state|lifecycle( phase| state)?|life cycle state)$/.test(t)),
    electrical: texts.some((t) => /^(ref(erence)?s?|ref\.? ?des(ignators?)?|designators?|refdes|value)$/.test(t)),
    sap: texts.includes('short text'),
  };
  return texts.map((text) => (text ? classifyHeading(text, ctx) : null));
}

/** Every column a header row names, strongest first for each field (the earlier column on a tie). */
function headerCandidates(cells: readonly unknown[]): Map<Field, Candidate[]> {
  const found = new Map<Field, Candidate[]>();
  headingHits(cells).forEach((hit, col) => {
    if (hit) found.set(hit.field, [...(found.get(hit.field) ?? []), { col, strength: hit.strength, ...(hit.kind ? { kind: hit.kind } : {}) }]);
  });
  return new Map([...found].map(([f, list]) => [f, list.sort((a, b) => b.strength - a.strength || a.col - b.col)]));
}

const cellText = (row: readonly unknown[] | undefined, i: number | undefined): string => (row === undefined || i === undefined ? '' : String(row[i] ?? '').trim());
const nonBlank = (row: readonly unknown[] | undefined): boolean => (row ?? []).some((v) => norm(v));
const isHeaderLike = (f: Map<Field, Candidate[]>): boolean => f.size >= 2 && (f.has('partNumber') || f.has('description'));

/**
 * A row with a part number (a value with a digit that is neither a heading nor a price or quantity
 * heading such as "Price @ 1,000") under the table's part-number column is one of its rows, whatever else
 * it holds.
 */
const holdsPart = (row: readonly unknown[] | undefined, table: Map<Field, Candidate[]>): boolean =>
  (table.get('partNumber') ?? []).some((c) => {
    const t = cellText(row, c.col);
    return /\d/.test(t) && !/[@$]|\b(price|cost|qty|quantity|pcs|usd)\b/i.test(t) && !classifyHeading(heading(t), NO_CONTEXT);
  });

/** A header row whose known headings all lie right of the table's columns: a block beside it (revision history, tooling). */
const beside = (h: Map<Field, Candidate[]>, table: Map<Field, Candidate[]>): boolean => {
  const last = Math.max(...[...table.values()].flat().map((c) => c.col));
  return [...h.values()].flat().every((c) => c.col > last);
};

/** Two heading rows read as one: "Part" over "No." is "Part No."; a merged cell repeated into both is read once. */
const stacked = (top: readonly unknown[], bottom: readonly unknown[]): string[] =>
  Array.from({ length: Math.max(top.length, bottom.length) }, (_, c) => {
    const a = norm(top[c]), b = norm(bottom[c]);
    return a === b ? a : `${a} ${b}`.trim();
  });

// A title block row: two or more known labels, each followed by its value (one with a digit), over a row
// with more labels and no digits where this one has its labels ("Customer P/N | 4100-0001 | Rev | C" over
// "RFQ No. | Q-118 | Due Date | ..." or over the table's own header). A one-cell note or date line under
// the block is passed over; with nothing but those under it, it is a title block too.
function titleBlockRow(rows: readonly (readonly unknown[])[], r: number): boolean {
  const texts = (rows[r] ?? []).map(heading);
  const known = texts.map((t) => (t ? classifyHeading(t, NO_CONTEXT) : null));
  const labels = known.flatMap((k, c) => (k ? [c] : []));
  if (labels.length < 2 || !labels.every((c) => !!texts[c + 1] && !known[c + 1])) return false;
  if (!labels.some((c) => /\d/.test(texts[c + 1] ?? ''))) return false;
  let n = r + 1;
  // A units row under a header ("(ea)", "(USD)") is passed over too: the first row of values decides.
  const units = (row: readonly unknown[] | undefined) => { const v = (row ?? []).map(norm).filter(Boolean); return v.length > 0 && v.every((t) => /^\(.*\)$/.test(t)); };
  while (n < rows.length && (new Set((rows[n] ?? []).map(norm).filter(Boolean)).size <= 1 || units(rows[n]))) n++;
  // With nothing but one-value lines under it, it is a title block, unless two or more of them are
  // numbers down a label's column ("Part Number" over 4100-1010, 4100-1011): that is a table. A note has words.
  if (n >= rows.length) return !labels.some((c) => /\s/.test(texts[c + 1] ?? '') && rows.slice(r + 1).filter((row) => /^\S*\d\S*$/.test(norm(row[c]))).length >= 2);
  const next = (rows[n] ?? []).map(norm);
  return labels.some((c) => !!next[c]) && labels.every((c) => !/\d/.test(next[c] ?? ''));
}

// A find number: 1, 10, 0010, 1.1, 1.2.3, 2A (never 10.1234: that is a part number).
const FIND_NUMBER = /^\d{1,4}(\.\d{1,2})*[A-Za-z]?$/;
// A column of the sheet's own find or line numbers.
const FIND_HEADING = /^(find|line|balloon|pos(ition)?)[\s.-]*(item[\s.-]*)?((no|nr|nbr|num(ber)?|#|id|seq(uence)?)\.?)?$|^item\s*#?$/;
// A component's value in an electrical BOM: 10K, 0.1uF, 4.7nF, 4K7, 0R, DNP, and bare numbers of three
// significant digits (100, 4700, 49.9), never a part number such as 300042.
// A bare value has at most three significant digits (49.9, 0.022, 4700); before a unit, up to three digits
// then any decimals (32.768kHz). Never 36.6642, 300042A or 123456R: those are part numbers.
const SIG3 = String.raw`(0(\.0*[1-9]\d{0,2})?|[1-9]\d{0,2}0*(\.0+)?|[1-9]\.\d{1,2}|[1-9]\d\.\d)`;
const COMPONENT_VALUE = new RegExp(String.raw`^(${SIG3}|(${SIG3}|\d{1,3}\.\d+)\s*((p|n|u|µ|m|k|meg|g)\s*(f|h|ohms?|Ω|r|v|w|a|hz|%)?|(f|h|ohms?|Ω|r|v|w|a|hz|%))|\d+[rkmunp]\d+|dnp|nc)$`, 'i');
// A sum line, as a quote form's part number or description: "TOTAL", "Totals:", "Subtotal", "Grand Total
// (USD)", "Total tooling", "TOTAL OF ... PER ASSEMBLY", "Order total", "Sum".
const SUM_LABEL = /^((sub|grand)[\s-]*)?totals?\s*((of|per|for)\b.*|(cost|costs|price|prices|amount|value|qty|quantity|tooling|nre|usd|each|ea|\$)\s*(\(.*\))?)?\s*:?$|^[a-z][a-z -]{0,30}\s+totals?\s*(\(.*\))?\s*:?$|^sum\s*:?$/i;
// A sum line when its quantity is blank: "Total Unit Price", "TOTAL ASSEMBLY COST", "Assembly total". A
// part named "TOTAL ..." (a TotalEnergies grease) with a quantity, A/R or REF stays.
const BLANK_QTY_SUM = /^((sub|grand)[\s-]*)?totals?\s.*\b(cost|costs|price|prices|amount|value|parts|pcs|pieces|each)\s*(\(.*\))?\s*:?$|\btotals?\s*(\(.*\))?\s*:?$/i;
// A PLM version is revision.iteration ("C.1", "-.1", "A.2 (Design)"); its first part is the revision.
const VERSION = /^([A-Za-z]{1,3}|-|\d{1,3})\.(\d+)(\s*\([^)]*\))?$/;
// A quantity with a piece unit: "2 EA", "8 PCS", "4x".
const QTY_WITH_UNIT = /^(\d+(\.\d+)?)\s*(ea|each|pcs?|pieces|x)\.?$/i;

type Rows = readonly (readonly unknown[])[];

export function proposeLines(sheets: readonly { name: string; rows: Rows }[]): BomResult {
  type Header = { sheet: string; top: number; headerRow: number; fields: Map<Field, Candidate[]>; texts: string[]; rows: Rows; rank: number; data: number };
  let best: Header | null = null;
  const headers: Header[] = [];
  for (const s of sheets) {
    const single = s.rows.map((row, r) => (r < 50 ? headerCandidates(row) : NO_FIELDS));
    for (let r = 0; r < Math.min(20, s.rows.length); r++) {
      if (titleBlockRow(s.rows, r)) continue;
      const row = s.rows[r] ?? [];
      const options = [{ last: r, fields: single[r] ?? NO_FIELDS, texts: row.map(heading) }];
      const below = s.rows[r + 1] ?? [];
      if (nonBlank(row) && nonBlank(below) && !titleBlockRow(s.rows, r + 1)) {
        const both = stacked(row, below);
        const fields = headerCandidates(both);
        // Read as one only when that names more than the lower row alone, or the upper row heads two or
        // more columns ("Part | Part | Quantity" over "Number | Rev | Per Assy"). An upper cell heads a
        // column only when the stacked heading keeps the lower one's field at least as strong (or the lower
        // alone is unknown), or it is one party word that refuses a part heading ("Supplier" over "Part
        // No."). A sheet title or company name over "Part Number" does neither.
        const lower = headingHits(below), stackedHits = headingHits(both);
        const heads = row.filter((v, c) => {
          const top = norm(v);
          if (!top || !norm(below[c]) || /\d/.test(top)) return false;
          // A title block's label ("Prepared By:") or the value after it ("J. Smith") heads no column, unless merged down into it.
          const label = (k: number) => /:$/.test(String(row[k] ?? '').trim());
          if ((label(c) || (c > 0 && label(c - 1))) && top !== norm(below[c])) return false;
          const lo = lower[c], st = stackedHits[c];
          if (!lo || (st && st.field === lo.field && st.strength >= lo.strength)) return true;
          return !/\s/.test(heading(v)) && refused(heading(v));
        }).length;
        if (fields.size >= 2 && fields.size >= (single[r]?.size ?? 0) && (fields.size > (single[r + 1]?.size ?? 0) || heads >= 2)) {
          options.push({ last: r + 1, fields, texts: both.map(heading) });
        }
      }
      for (const o of options) {
        if (!o.fields.has('partNumber') && !o.fields.has('description')) continue;
        // Evidence of a table: rows below, up to the next header-like row, with a value under the part
        // number or description.
        const cols = [...(o.fields.get('partNumber') ?? []), ...(o.fields.get('description') ?? [])].map((c) => c.col);
        let data = 0;
        const window: (readonly unknown[])[] = [];
        const pnCols = (o.fields.get('partNumber') ?? []).map((c) => c.col);
        const others = [...o.fields].flatMap(([f, list]) => (f === 'revision' || f === 'description' || f === 'qtyPer' ? list.map((c) => c.col) : [])).filter((c) => !pnCols.includes(c));
        for (let i = o.last + 1; i < Math.min(s.rows.length, o.last + 30); i++) {
          if (isHeaderLike(single[i] ?? NO_FIELDS) && !beside(single[i] ?? NO_FIELDS, o.fields) && !holdsPart(s.rows[i], o.fields)) break;
          if (cols.some((c) => cellText(s.rows[i], c))) data++;
          window.push(s.rows[i] ?? []);
        }
        // Rows of the table under it: a part number with another value (alone when its revision, description
        // and quantity are empty throughout), or, with no part number, a description and another field.
        const pnOf = o.fields.get('partNumber') ?? [];
        const usedOthers = others.filter((c) => window.some((row) => cellText(row, c)));
        const span = Math.max(...[...o.fields.values()].flat().map((c) => c.col));
        const values = (row: readonly unknown[]) => new Set(row.slice(0, span + 1).map(norm).filter(Boolean)).size;
        const tableRow = (row: readonly unknown[]) => holdsPart(row, o.fields)
          ? usedOthers.length === 0 || usedOthers.some((c) => cellText(row, c)) || values(row) >= 2
          : pnOf.every((c) => !cellText(row, c.col)) && o.fields.has('description') && [...o.fields].filter(([, list]) => list.some((c) => cellText(row, c.col))).length >= 2;
        // Counted down to the first other row with two values within its columns (a title block's next block
        // is not its table; a banner, a note or a block beside the table is passed over).
        let tableRows = 0;
        for (const row of window) {
          if (tableRow(row)) tableRows++;
          else if (tableRows > 0 && values(row) >= 2) break;
        }
        // Rows under it first, then two or more rows of the table under a header naming two or more columns (a
        // title block has one row of values, a column guide prose), then more known columns, then one naming a part number, then a description;
        // the earlier row on a tie.
        const rank = (data > 0 ? 1000 : 0) + (tableRows >= 2 && isHeaderLike(o.fields) ? 500 : 0) + o.fields.size * 4 + (o.fields.has('partNumber') ? 2 : 0) + (o.fields.has('description') ? 1 : 0);
        const h: Header = { sheet: s.name, top: r, headerRow: o.last, fields: o.fields, texts: o.texts, rows: s.rows, rank, data };
        headers.push(h);
        if (!best || rank > best.rank) best = h;
      }
    }
  }
  if (!best) return { sheet: null, headerRow: null, lines: [], problem: 'No column headed part number or description was found in the first 20 rows.' };
  // The parts start at the first table on that sheet with a part-number column and parts under it above
  // the best header (purchased parts above fabricated ones); later tables are read in turn.
  const chosen = best as Header;
  const start = headers.find((h) => h.rows === chosen.rows && h.headerRow < chosen.top && h.data > 0 && isHeaderLike(h.fields) && h.fields.has('partNumber')
    && h.rows.slice(h.headerRow + 1, chosen.top).some((row) => holdsPart(row, h.fields))
    && !headers.some((o) => o.rows === h.rows && o.headerRow === h.headerRow && o.rank > h.rank)) ?? chosen;
  const { sheet, headerRow, fields, texts, rows } = start;
  const lines = readTable(rows, headerRow, fields, texts);
  return { sheet, headerRow, lines, problem: lines.length ? null : 'The header was found but no rows below it name a part.' };
}

const sameColumns = (a: Map<Field, Candidate[]>, b: Map<Field, Candidate[]>): boolean =>
  a.size === b.size && [...b].every(([f, list]) => a.get(f)?.[0]?.col === list[0]?.col);

/**
 * The parts under a header, down to a later table with its own, different header naming a part number or
 * as many columns (a one-row table for the assembly above the BOM, or purchased parts below fabricated
 * ones), which is then read the same way.
 */
function readTable(rows: Rows, headerRow: number, candidates: Map<Field, Candidate[]>, texts: string[]): ProposedLine[] {
  let end = rows.length;
  let next: { headerRow: number; fields: Map<Field, Candidate[]>; texts: string[] } | null = null;
  const words = (t: readonly string[]) => { const w = [...t]; while (w.length && !w[w.length - 1]) w.pop(); return w.join('|'); };
  const repeats = (both: string[]) => words(both.map(heading)) === words(texts);
  // A row of this table: a description under its description column that is not a heading.
  const describes = (row: readonly unknown[] | undefined) => (candidates.get('description') ?? []).some((c) => { const t = cellText(row, c.col); return !!t && !classifyHeading(heading(t), NO_CONTEXT); });
  for (let j = headerRow + 1; j < rows.length; j++) {
    const h = headerCandidates(rows[j] ?? []);
    // The lower row of a repeated two-row header ("Part" over "Number" again after a section title) is part
    // of the repeat, not a new table.
    if (j > headerRow + 1 && repeats(stacked(rows[j - 1] ?? [], rows[j] ?? []))) continue;
    if (nonBlank(rows[j + 1]) && repeats(stacked(rows[j] ?? [], rows[j + 1] ?? []))) { j++; continue; }
    // A later header naming only part-number columns ("Customer Part No. | Nomenclature | Mfr | Mfr P/N")
    // starts a table too when it repeats the part-number heading over the table's own column.
    const repeatsPn = j > headerRow + 1 && h.has('partNumber') && headingHits(rows[j] ?? []).filter(Boolean).length >= 2
      && (candidates.get('partNumber') ?? []).some((c) => classifyHeading(heading(cellText(rows[j], c.col)), NO_CONTEXT)?.field === 'partNumber');
    if ((isHeaderLike(h) || repeatsPn) && (h.size >= candidates.size || h.has('partNumber')) && !sameColumns(h, candidates) && !(holdsPart(rows[j], candidates) && (beside(h, candidates) || describes(rows[j]) || h.size <= candidates.size)) && !titleBlockRow(rows, j)) {
      // A two-row heading ("QTY" over "100"): the upper row belongs to the next table, read as one with it.
      const up = rows[j - 1];
      const both = stacked(up ?? [], rows[j] ?? []);
      const stackedFields = j - 1 > headerRow && nonBlank(up) && !holdsPart(up, candidates) ? headerCandidates(both) : NO_FIELDS;
      // Read as one only when that keeps every column the lower row names, as strongly ("MOLDED PARTS" over
      // "Briggs & Stratton Part #" or over "P/N" does not).
      const keeps = [...h].every(([f, list]) => list.every((c) => stackedFields.get(f)?.some((k) => k.col === c.col && k.strength >= c.strength)));
      // Group headings merged over the next table's columns ("Customer | Customer | Supplier | Supplier"),
      // every value repeated, belong to it too.
      const values = (up ?? []).map(norm).filter(Boolean);
      const grouped = j - 1 > headerRow && !holdsPart(up, candidates) && values.length >= 2 && values.every((v) => values.indexOf(v) !== values.lastIndexOf(v));
      end = stackedFields.size >= h.size || grouped ? j - 1 : j;
      next = keeps && stackedFields.size >= h.size ? { headerRow: j, fields: stackedFields, texts: both.map(heading) } : { headerRow: j, fields: h, texts: (rows[j] ?? []).map(heading) };
      break;
    }
  }
  const body = rows.slice(headerRow + 1, end);
  const column = (c: number) => body.map((row) => cellText(row, c)).filter(Boolean);
  const filled = (c: number) => column(c).length;
  // Mostly headings or labels ("Rev", "Description:") on the rows with a part number in another part-number
  // column: a title block beside the table, not its values. A repeated header, a signature line, a note or
  // a summary under the table ("Component Count: 13") is not one of those rows.
  const isLabel = (v: string) => /:\s*$/.test(v) || !!classifyHeading(heading(v), NO_CONTEXT);
  const labels = (c: number) => {
    const others = (candidates.get('partNumber') ?? []).map((k) => k.col).filter((k) => k !== c);
    const vals = body.filter((row) => others.some((k) => { const t = cellText(row, k); return /\d/.test(t) && !isLabel(t); })).map((row) => cellText(row, c)).filter(Boolean);
    const n = vals.filter(isLabel).length;
    return n >= 2 && n * 2 > vals.length;
  };
  const fields = new Map<Field, number>();
  for (const [f, all] of candidates) {
    // A board's, harness's or cable's revision ("Board Rev", "Cable Rev") is the parent's, never the line's.
    const list = f === 'revision' ? all.filter((c) => !/^(board|cca|pwb|pwa|harness|cable)\b/.test(texts[c.col] ?? '')) : all;
    const col = (list.find((c) => filled(c.col) > 0 && !(f === 'revision' && labels(c.col))) ?? list[0])?.col;
    if (f !== 'partNumber' && col !== undefined) fields.set(f, col);
  }
  // A board's or harness's own number ("CCA P/N", "Harness P/N") names the parent, never the line's part.
  const pn = partNumberColumn((candidates.get('partNumber') ?? []).filter((c) => !/^(board|cca|pwb|pwa|harness)\b/.test(texts[c.col] ?? '')), {
    filled,
    // Mostly find numbers counting up from 100 or less (a section heading, note, REF or 2A among them
    // does not change that), unless the sheet has its own find or line column beside this one.
    findNumbers: (c) => {
      if (!FIND_HEADING.test(texts[c] ?? '') && texts.some((t, j) => j !== c && FIND_HEADING.test(t))) return false;
      // Counted over the rows with another of the table's columns filled: a note, a section title or a sum
      // label alone in the column, or merged across the table, is not one of its values; nor is a label
      // ("Quoted By:") under it.
      const elsewhere = [...candidates.values()].flat().map((k) => k.col).filter((k) => k !== c);
      const values = body.filter((row) => elsewhere.some((k) => cellText(row, k)) && new Set(row.map(norm).filter(Boolean)).size >= 2).map((row) => cellText(row, c)).filter((v) => v && !isLabel(v));
      const finds = values.filter((v) => FIND_NUMBER.test(v));
      return finds.length * 2 > values.length && Math.min(...finds.map((v) => parseInt(v, 10))) <= 100;
    },
    values: (c) => column(c).filter((v) => COMPONENT_VALUE.test(v)).length * 2 > filled(c),
    labels,
    distinct: (c) => new Set(column(c).map((v) => v.toLowerCase())).size * 2 > filled(c),
    numbers: (c, m) => {
      const values = body.filter((row) => /\d/.test(cellText(row, m))).map((row) => cellText(row, c)).filter(Boolean);
      // With no number in column m at all (only repeated headings), there is nothing to weigh against.
      return values.filter((v) => /\d/.test(v)).length * 2 >= values.length;
    },
    covers: (c, m) => {
      const bought = body.filter((row) => cellText(row, m));
      return bought.filter((row) => cellText(row, c)).length * 2 > bought.length;
    },
    described: (() => {
      const d = fields.get('description');
      if (d === undefined || filled(d) === 0) return false;
      // Descriptions tell the rows apart unless one is blank, or two under the same parent (1.1 and 1.2, or
      // 1 and 2) are the same: CAD lists each component once under its parent, so those are two parts (a cut
      // list: one profile at several lengths). The find numbers stand in only when they are all different.
      if (fields.has('level')) return true;
      const items = (candidates.get('partNumber') ?? []).filter((c) => c.kind === 'item').map((c) => c.col);
      const numbered = body.flatMap((row) => { const c = items.find((i) => FIND_NUMBER.test(cellText(row, i))); return c === undefined ? [] : [{ find: cellText(row, c), desc: norm(cellText(row, d)) }]; });
      if (new Set(numbered.map((r) => r.find)).size < numbered.length) return true;
      const siblings = new Set<string>();
      for (const r of numbered) {
        const key = `${r.find.replace(/\.?[^.]*$/, '')}|${r.desc}`;
        if (!r.desc || siblings.has(key)) return false;
        siblings.add(key);
      }
      return true;
    })(),
  });
  if (pn !== undefined) fields.set('partNumber', pn);
  // An electrical BOM's Part holding values (10K, 0.1uF), not taken as the part number, describes the line when nothing else does.
  const valueCol = (candidates.get('partNumber') ?? []).find((c) => c.kind === 'value' && c.col !== pn && filled(c.col) > 0)?.col;
  if (valueCol !== undefined && !(fields.has('description') && filled(fields.get('description') as number) > 0)) fields.set('description', valueCol);
  const revisionIsVersion = /^(version|ver\.?)$/.test(texts[fields.get('revision') ?? -1] ?? '');
  const labelCols = [fields.get('partNumber'), fields.get('description')].filter((c): c is number => c !== undefined);
  // A repeat of the header, as a BOM printed one table per subassembly repeats it.
  const repeatsHeader = (row: readonly unknown[]) =>
    [...fields].filter(([f, c]) => { const t = cellText(row, c); return t.length < 40 && t && classifyHeading(heading(t), NO_CONTEXT)?.field === f; }).length >= 2;
  // A banner merged across the whole table (an instruction), or a section title over a repeat of the
  // header. A charge row merged over part number to quantity (Tooling, NRE) is kept.
  const banner = (row: readonly unknown[], i: number) => {
    const q = cellText(row, fields.get('qtyPer'));
    if (!q || !Number.isNaN(Number(q.replace(/,/g, ''))) || labelCols.length === 0 || !labelCols.every((c) => cellText(row, c) === q)) return false;
    if (texts.every((h, c) => !h || cellText(row, c) === q)) return true;
    if (!row.every((_, c) => !cellText(row, c) || cellText(row, c) === q)) return false;
    let n = i + 1;
    while (n < body.length && !nonBlank(body[n])) n++;
    return n < body.length && repeatsHeader(body[n] ?? []);
  };
  const lines: ProposedLine[] = [];
  body.forEach((row, i) => {
    const partNumber = cellText(row, fields.get('partNumber'));
    const description = cellText(row, fields.get('description'));
    if (!partNumber && !description) return;
    if (repeatsHeader(row) || banner(row, i)) return;
    const qtyCell = cellText(row, fields.get('qtyPer'));
    const labels = [partNumber, description].filter(Boolean);
    // A sum line: every label in it reads as one; with a blank quantity, labels that start or end with
    // "total"; Excel's Data > Subtotal row, "<the group's value> Total".
    if (labels.every((t) => SUM_LABEL.test(t))) return;
    if (fields.has('qtyPer') && (!qtyCell || /^[-–—]$/.test(qtyCell)) && labels.every((t) => BLANK_QTY_SUM.test(t))) return;
    const above = body[i - 1];
    if (labelCols.every((c) => !cellText(row, c) || (!!cellText(above, c) && cellText(row, c).toLowerCase() === `${cellText(above, c).toLowerCase()} total`))) return;
    const qtyRaw = qtyCell.replace(/,/g, '');
    const qty = Number(QTY_WITH_UNIT.exec(qtyRaw)?.[1] ?? qtyRaw);
    const revRaw = cellText(row, fields.get('revision'));
    const version = revisionIsVersion && revRaw ? VERSION.exec(revRaw) : null;
    const revision = !revisionIsVersion ? revRaw : version ? (version[1] ?? '') : /^[A-Za-z]{1,3}$/.test(revRaw) ? revRaw : '';
    const notes = [
      fields.has('level') && cellText(row, fields.get('level')) ? `Level ${cellText(row, fields.get('level'))}` : '',
      cellText(row, fields.get('material')) ? `Material: ${cellText(row, fields.get('material'))}` : '',
      qtyRaw && !(qty > 0) ? `Quantity per in the file: "${qtyRaw}"` : '',
      revisionIsVersion && revRaw && revRaw !== revision ? `Version in the file: "${revRaw}"` : '',
      cellText(row, fields.get('notes')),
    ].filter(Boolean).join('. ');
    lines.push({ partNumber, revision, description, qtyPer: qty > 0 ? qty : 1, notes });
  });
  return next ? [...lines, ...readTable(rows, next.headerRow, next.fields, next.texts)] : lines;
}

interface ColumnFacts {
  /** Mostly headings or labels. */
  labels: (c: number) => boolean;
  filled: (c: number) => number;
  findNumbers: (c: number) => boolean;
  /** Mostly component values (10K, 0.1uF). */
  values: (c: number) => boolean;
  /** Mostly different values, not a parent repeated down the rows. */
  distinct: (c: number) => boolean;
  /** On the rows where column m holds a number, at least half of c's values have a digit, as part numbers do (labels such as "Email" or "Due Date" do not). */
  numbers: (c: number, m: number) => boolean;
  /** Filled on most of the rows where column m is. */
  covers: (c: number, m: number) => boolean;
  described: boolean;
}

/** The part-number column: see the rules above the headings. */
function partNumberColumn(list: readonly Candidate[], facts: ColumnFacts): number | undefined {
  const real = list
    .filter((c) => !(c.kind === 'item' && facts.findNumbers(c.col)) && !facts.labels(c.col))
    // An electrical BOM's Part holding values (10K) ranks below the manufacturer's number.
    .map((c) => (c.kind === 'value' && facts.values(c.col) ? { ...c, strength: 1.25 } : c))
    .sort((a, b) => b.strength - a.strength || a.col - b.col);
  let chosen = real.find((c) => facts.filled(c.col) > 0);
  if (chosen?.kind === 'dwg') {
    // A drawing number covers several dash numbers and no bought part: the customer's own number, filled on
    // as many rows with different values, is the part's.
    const dwg = chosen;
    chosen = real.find((c) => c.kind !== 'mfr' && c.kind !== 'dwg' && c.strength >= 1.75 && facts.filled(c.col) >= facts.filled(dwg.col) && facts.distinct(c.col) && facts.numbers(c.col, dwg.col) && facts.covers(c.col, dwg.col)) ?? dwg;
  }
  if (chosen?.kind === 'mfr') {
    // A customer's numbering covers the made parts and most of the bought ones (all of them, where every
    // row is bought); a parent repeated down the rows never does.
    const mfr = chosen;
    chosen = real.find((c) => c.kind !== 'mfr' && c.strength >= 1.75 && facts.filled(c.col) >= facts.filled(mfr.col) && facts.distinct(c.col) && facts.numbers(c.col, mfr.col) && facts.covers(c.col, mfr.col)) ?? mfr;
  }
  if (chosen) return chosen.col;
  // Only find numbers have values: they stand in for part numbers only when there is no description.
  // Never when the sheet has a part-number column of its own, empty or not.
  return facts.described || list.some((c) => c.kind !== 'item') ? undefined : (list.find((c) => facts.filled(c.col) > 0) ?? list[0])?.col;
}
