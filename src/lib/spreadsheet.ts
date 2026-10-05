// Spreadsheet files as sheets of text rows: .xlsx through exceljs, .csv by hand. Values become text
// as shown; the code that reads a column decides what it means.
import ExcelJS from 'exceljs';
import { decodeText, parseCsv } from './csv.ts';

export interface TextSheet { name: string; rows: string[][] }

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return '';
  }
  return String(v);
}

export const isSpreadsheet = (fileName: string): boolean => /\.(xlsx|xlsm|csv)$/i.test(fileName);

export async function readSpreadsheet(fileName: string, bytes: Buffer): Promise<TextSheet[]> {
  if (/\.csv$/i.test(fileName)) return [{ name: fileName, rows: parseCsv(decodeText(bytes).text) }];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values = row.values as ExcelJS.CellValue[];
      rows[n - 1] = values.slice(1).map(cellText);
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { name: ws.name, rows };
  });
}
