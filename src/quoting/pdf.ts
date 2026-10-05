// The customer's copy of a quote, as a PDF made on this server. It shows what the customer is quoted:
// part, quantities and unit prices (business development's where set), the assembly price when the
// quote is one assembly, one-time charges and lead time. It never shows how a price was reached.
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { QuoteDetail } from '../persistence/quotes.ts';
import { PROJECT_ROOT } from '../server/config.ts';

const LOGO = join(PROJECT_ROOT, 'src', 'assets', 'mack-logo-black.png');

const usd = (n: number): string => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });
const qty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const day = (iso: string | null): string => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '');

export interface PdfOptions {
  /** Terms printed at the end, as an administrator wrote them; nothing is printed when empty. */
  terms: string;
  preparedBy: { name: string; email: string | null };
  today: string;
}

export function quotePdf(d: QuoteDetail, opts: PdfOptions): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: `Quote ${d.quote.number}`, Author: 'Mack Molding' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const ink = '#1d1d1f';
  const muted = '#5f6368';
  const rule = '#d0d4da';

  if (existsSync(LOGO)) doc.image(LOGO, left, 48, { height: 34 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(ink).text('Quotation', left, 50, { width, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(muted)
    .text(`${d.quote.number}${d.quote.revision ? ` rev ${d.quote.revision}` : ''}  ·  ${day(opts.today)}`, left, 76, { width, align: 'right' });
  doc.moveTo(left, 100).lineTo(left + width, 100).strokeColor(rule).lineWidth(1).stroke();

  let y = 114;
  const field = (label: string, value: string, x: number, w: number) => {
    doc.font('Helvetica').fontSize(8).fillColor(muted).text(label.toUpperCase(), x, y, { width: w });
    doc.font('Helvetica').fontSize(10.5).fillColor(ink).text(value || '—', x, y + 11, { width: w });
  };
  field('Prepared for', [d.quote.customerName ?? '', d.quote.contactName ?? ''].filter(Boolean).join('\n'), left, width / 2 - 10);
  field('Prepared by', [opts.preparedBy.name, opts.preparedBy.email ?? ''].filter(Boolean).join('\n'), left + width / 2, width / 2);
  y += 52;
  if (d.quote.title) {
    field('Subject', d.quote.title, left, width);
    y += 36;
  }

  // One table: a row per part and quantity.
  const cols = [
    { label: 'Part', w: 0.34 },
    { label: 'Description', w: 0.30 },
    { label: 'Quantity', w: 0.11, right: true },
    { label: 'Unit price', w: 0.12, right: true },
    { label: 'Extended', w: 0.13, right: true },
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => { xs.push(x); return x + c.w * width; }, left);
  const header = () => {
    doc.rect(left, y, width, 18).fill('#f1f3f5');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(muted);
    cols.forEach((c, i) => doc.text(c.label.toUpperCase(), (xs[i] as number) + 4, y + 5, { width: c.w * width - 8, align: c.right ? 'right' : 'left' }));
    y += 22;
  };
  const ensure = (h: number) => {
    if (y + h > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
  };
  header();
  d.lines.forEach((line, i) => {
    const sheet = d.sheet.lines[i];
    if (!sheet) return;
    const part = [line.partNumber || '(no part number)', line.revision ? `Rev ${line.revision}` : ''].filter(Boolean).join('  ');
    const descH = doc.font('Helvetica').fontSize(9.5).heightOfString(line.description || '', { width: (cols[1]?.w ?? 0) * width - 8 });
    ensure(Math.max(16 * sheet.cells.length, descH) + 8);
    const top = y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ink).text(part, (xs[0] as number) + 4, y, { width: (cols[0]?.w ?? 0) * width - 8 });
    if (line.qtyPer !== 1 && line.quantities.length === 0) doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(`${qty(line.qtyPer)} per assembly`, (xs[0] as number) + 4, doc.y + 1, { width: (cols[0]?.w ?? 0) * width - 8 });
    doc.font('Helvetica').fontSize(9.5).fillColor(ink).text(line.description || '', (xs[1] as number) + 4, top, { width: (cols[1]?.w ?? 0) * width - 8 });
    let ry = top;
    for (const c of sheet.cells) {
      doc.font('Helvetica').fontSize(9.5).fillColor(ink);
      doc.text(qty(c.quantity), (xs[2] as number) + 4, ry, { width: (cols[2]?.w ?? 0) * width - 8, align: 'right' });
      doc.text(c.unitPrice === null ? '—' : usd(c.unitPrice), (xs[3] as number) + 4, ry, { width: (cols[3]?.w ?? 0) * width - 8, align: 'right' });
      doc.text(c.extended === null ? '—' : usd(c.extended), (xs[4] as number) + 4, ry, { width: (cols[4]?.w ?? 0) * width - 8, align: 'right' });
      ry += 16;
    }
    y = Math.max(ry, top + descH, doc.y) + 6;
    doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor(rule).lineWidth(0.5).stroke();
  });

  if (d.sheet.assembly) {
    ensure(30 + 16 * d.sheet.assembly.length);
    y += 8;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text('Price per assembly', left, y);
    y += 16;
    for (const b of d.sheet.assembly) {
      doc.font('Helvetica').fontSize(9.5).fillColor(ink);
      doc.text(`${qty(b.quantity)} assemblies`, left, y, { width: width * 0.5 });
      doc.text(b.unitPrice === null ? '—' : `${usd(b.unitPrice)} each`, left + width * 0.5, y, { width: width * 0.25, align: 'right' });
      doc.text(b.extended === null ? '—' : usd(b.extended), left + width * 0.75, y, { width: width * 0.25, align: 'right' });
      y += 16;
    }
  }

  const oneTime = d.lines.map((l, i) => ({ l, s: d.sheet.lines[i] })).filter((x) => (x.s?.oneTimeCost ?? 0) > 0);
  if (oneTime.length) {
    ensure(30 + 16 * oneTime.length);
    y += 10;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text('One-time charges', left, y);
    y += 16;
    for (const { l, s } of oneTime) {
      doc.font('Helvetica').fontSize(9.5).fillColor(ink).text(`${s?.oneTimeLabel || 'Tooling'}: ${l.partNumber || l.description}`, left, y, { width: width * 0.75 });
      doc.text(usd(s?.oneTimeCost ?? 0), left + width * 0.75, y, { width: width * 0.25, align: 'right' });
      y += 16;
    }
  }

  ensure(60);
  y += 12;
  if (d.sheet.leadTimeWeeks !== null) {
    doc.font('Helvetica').fontSize(10).fillColor(ink).text(`Lead time: ${qty(d.sheet.leadTimeWeeks)} weeks after receipt of order.`, left, y, { width });
    y = doc.y + 6;
  }
  if (opts.terms.trim()) {
    doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(opts.terms.trim(), left, y + 6, { width });
  }
  doc.end();
  return done;
}
