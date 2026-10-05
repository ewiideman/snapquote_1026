// Reading CSV files as rows of text (RFC 4180): quoted fields, doubled quotes, commas and line breaks
// inside quotes, CRLF or LF. Values stay text -- a CSV has no types, and guessing them is how a date
// written 20260918 becomes a number. The code that reads a column decides what it means.

/** Decodes a file's bytes: UTF-8 (with or without a byte-order mark), or Windows-1252 when it is not UTF-8. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding: 'utf-8' };
  } catch {
    // IBM i and Windows tools often write the Windows code page. Every byte is a character in it, so
    // this cannot fail; the encoding is reported so a garbled file can be traced to it.
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** Every row of the file, fields as written. A trailing line break does not make an empty last row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < n) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { endField(); i++; continue; }
    if (c === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new Error('The file ends inside a quoted field: it is incomplete or its quotes are unbalanced.');
  if (field !== '' || row.length) endRow();
  return rows;
}
