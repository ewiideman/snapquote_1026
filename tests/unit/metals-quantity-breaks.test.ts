// Quantity breaks are ASSEMBLIES (SnapQuote 0626 commit 5920baa): every amortized cost uses
// parts = assemblies x partsPerAssembly, as Mack's workbook does (L8 = SUMMARY F34 x I4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METALS_MATERIAL_ITEMS,
  METALS_WORK_CELLS,
  metalsQuoteTotals,
  priceMetalsLine,
  type MetalsCatalog,
  type MetalsLineInput,
} from '../../src/pricing/metals/index.ts';

const CATALOG: MetalsCatalog = { workCells: METALS_WORK_CELLS, materialItems: METALS_MATERIAL_ITEMS };

function close(actual: number, expected: number, digits: number, msg?: string): void {
  assert.ok(Math.abs(expected - actual) < 10 ** -digits / 2, `${msg ?? ''} expected ${expected}, got ${actual}`);
}

function line(over: Partial<MetalsLineInput> = {}): MetalsLineInput {
  return {
    partNumber: 'P-20',
    quantityBreaks: [{ label: 'One', assemblies: 1 }],
    partsPerAssembly: 20,
    blank: { lengthMm: 100, widthMm: 50, thicknessMm: 1.27 },
    material: { itemNumber: 'SA0205048096' },
    operations: [
      { name: 'Laser', workCell: 'Trumpf Tru Laser 2030 Coax', setupHours: 0.167, runMinutesPerPiece: 0.5 },
      { name: 'Brake', workCell: 'Trumpf V85 CNC Press Brake', setupHours: 0.25, runMinutesPerPiece: 0.4 },
    ],
    ...over,
  };
}

const only = (l: MetalsLineInput) => {
  const b = priceMetalsLine(l, null, CATALOG).breaks[0];
  assert.ok(b);
  return b;
};

test("Chris's field report: programming on 1 assembly of 20 parts is divided by 20, not 1", () => {
  const b = only(line());
  assert.equal(b.assemblies, 1);
  assert.equal(b.parts, 20);
  const programmingTotal = 2 * 5 * (172 / 60);
  close(b.perPart.programming, programmingTotal / 20, 10);
  close(b.perPart.programming * b.parts, programmingTotal, 10);
});

test('the same part count prices the same whether stated as assemblies or as single parts', () => {
  const asAssemblies = only(line({ quantityBreaks: [{ label: 'A', assemblies: 5 }], partsPerAssembly: 4 }));
  const asParts = only(line({ quantityBreaks: [{ label: 'A', assemblies: 20 }], partsPerAssembly: 1 }));
  assert.equal(asAssemblies.parts, 20);
  assert.equal(asParts.parts, 20);
  close(asAssemblies.perPart.programming, asParts.perPart.programming, 12);
  close(asAssemblies.perPart.material, asParts.perPart.material, 12);
  // Setup is divided by partsPerAssembly as well (Mack J50), so labor differs by design.
  assert.ok(asAssemblies.perPart.labor < asParts.perPart.labor);
});

test('tooling and freight amortize over parts; hardware tiers resolve at parts', () => {
  const b = only(
    line({
      quantityBreaks: [{ label: 'Five', assemblies: 5 }],
      partsPerAssembly: 10,
      tooling: { items: [{ label: 'Die', amount: 1000 }] },
      overrides: { freightPerShipment: 25 },
      hardware: [{ label: 'rivet', quantity: 1, unitCost: 6.98, priceBreaks: [{ minQty: 10, unitCost: 1.396 }, { minQty: 50, unitCost: 0.28 }] }],
    }),
  );
  assert.equal(b.parts, 50);
  close(b.perPart.tooling, 1000 / 50, 12);
  close(b.perPart.freight, (25 * 4) / 50, 12);
  close(b.perPart.hardware, 0.28 * 1.2, 12);
});

test('extended price is unit price x parts, and quote totals sum it per break', () => {
  const a = priceMetalsLine(line({ quantityBreaks: [{ label: 'Low', assemblies: 5 }, { label: 'High', assemblies: 50 }], partsPerAssembly: 4 }), null, CATALOG);
  const b = priceMetalsLine(line({ partNumber: 'Q', quantityBreaks: [{ label: 'Low', assemblies: 5 }, { label: 'High', assemblies: 50 }], partsPerAssembly: 1 }), null, CATALOG);
  for (const r of [a, b]) for (const br of r.breaks) close(br.extendedPrice, br.unitPrice * br.parts, 10);
  const totals = metalsQuoteTotals([a, b]);
  assert.deepEqual(totals.byBreak.map((t) => t.label), ['Low', 'High']);
  totals.byBreak.forEach((t, i) => {
    close(t.extendedPrice, (a.breaks[i]?.extendedPrice ?? 0) + (b.breaks[i]?.extendedPrice ?? 0), 8);
  });
});

test('partsPerAssembly 1 is the default and prices identically to before', () => {
  const { partsPerAssembly: _omit, ...rest } = line();
  const implicit = only({ ...rest, quantityBreaks: [{ label: 'X', assemblies: 100 }] });
  const explicit = only(line({ quantityBreaks: [{ label: 'X', assemblies: 100 }], partsPerAssembly: 1 }));
  assert.equal(implicit.parts, 100);
  close(implicit.unitPrice, explicit.unitPrice, 12);
});

test('a bad partsPerAssembly or a non-positive break is reported, not thrown', () => {
  const r = priceMetalsLine(line({ partsPerAssembly: 0, quantityBreaks: [{ label: 'Zero', assemblies: 0 }, { label: 'Ten', assemblies: 10 }] }), null, CATALOG);
  assert.equal(r.partsPerAssembly, 1);
  assert.deepEqual(r.breaks.map((b) => b.label), ['Ten']);
  assert.ok(r.warnings.some((w) => w.includes('Parts per assembly')));
  assert.ok(r.warnings.some((w) => w.includes('"Zero" has no positive quantity')));
});
