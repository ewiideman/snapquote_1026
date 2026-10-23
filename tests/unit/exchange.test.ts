import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatorHours, CAPACITY_FORMAT, metalsHours, readCapacityFile, workCellCapacity, type CapacityFile } from '../../src/quoting/exchange.ts';

test('hours per work cell: one setup per lot plus run minutes × pieces, operations at one cell added', () => {
  const h = metalsHours([
    { workCell: 'L72', setupHours: 0.25, runMinutesPerPiece: 0.6 },
    { workCell: 'V85', setupHours: 0.5, runMinutesPerPiece: 1.2 },
    { workCell: 'V85', setupHours: 0.25, runMinutesPerPiece: 0.3 },
    { workCell: '', setupHours: 1, runMinutesPerPiece: 1 },
  ], [200, 1000]);
  assert.deepEqual(h, [
    { workCell: 'L72', at: [{ pieces: 200, setupHours: 0.25, runHours: 2, hours: 2.25 }, { pieces: 1000, setupHours: 0.25, runHours: 10, hours: 10.25 }] },
    { workCell: 'V85', at: [{ pieces: 200, setupHours: 0.75, runHours: 5, hours: 5.75 }, { pieces: 1000, setupHours: 0.75, runHours: 25, hours: 25.75 }] },
  ]);
});

const file: CapacityFile = {
  format: CAPACITY_FORMAT, version: 1, writtenAt: '2026-10-05T15:00:00Z', horizonWeeks: 12, basis: 'test',
  departments: [{ key: 'metals', label: 'Metals', asOf: '2026-10-05T14:00:00Z', scheduleName: 'Metals', facilities: [
    { code: '7/V85', name: 'V85', efficiency: 0.85, hoursPerWeek: 100, lateHours: 50, nextSixWeeksHours: 400, load: 0.75, caughtUpWeek: 2 },
    { code: '7/V130', name: 'V130', efficiency: 0.85, hoursPerWeek: 50, lateHours: 0, nextSixWeeksHours: 200, load: 0.67, caughtUpWeek: 0 },
    { code: '7/E18', name: 'E18', efficiency: 0.85, hoursPerWeek: 20, lateHours: 300, nextSixWeeksHours: 0, load: 2.5, caughtUpWeek: null },
  ] }],
};

test('a work cell of several facilities adds them; the latest catch-up week wins; one never caught up means never', () => {
  const c = workCellCapacity(file, 'metals', ['7/V85', '7/V130', '7/NOPE']);
  assert.equal(c.hoursPerWeek, 150);
  assert.equal(c.load, 0.72); // (50 + 600) / 900
  assert.equal(c.caughtUpWeek, 2);
  assert.deepEqual(c.unknown, ['7/NOPE']);
  assert.equal(c.efficiency, 0.85);
  assert.equal(workCellCapacity(file, 'metals', ['7/V85', '7/E18']).caughtUpWeek, null);
  assert.equal(workCellCapacity(file, 'metals', ['7/NOPE']).load, null);
});

test("the scheduler's file is checked, and a version this SnapQuote cannot read says so", () => {
  assert.ok('file' in readCapacityFile(file));
  assert.match((readCapacityFile({ ...file, version: 2 }) as { problem: string }).problem, /version 2/);
  assert.match((readCapacityFile({ format: 'other' }) as { problem: string }).problem, /not the scheduler/);
  const broken = { ...file, departments: [{ ...file.departments[0], facilities: [{ code: '7/X' }] }] };
  assert.match((readCapacityFile(broken) as { problem: string }).problem, /7\/X/);
});

// Oct 22, 2026: hours from every calculator, not only Metals.

test('Molding hours: pieces over parts an hour on the press it was priced on; setup is not in them', () => {
  const h = calculatorHours('molding', { basis: 'calculator', inputs: {}, detail: { press: { id: 'Cav-30 [2300 (268)]' }, process: { partsPerHour: 38 } } }, [100, 1000]);
  assert.ok('cells' in h);
  assert.equal(h.setupIncluded, false);
  assert.deepEqual(h.cells.map((c) => [c.workCell, c.at.map((a) => a.hours)]), [['Cav-30 [2300 (268)]', [2.63, 26.32]]]);
});

test('Machining hours: each machine, setup once a lot plus cycle seconds per piece', () => {
  const inputs = { primaryMachine: 'A20', primarySetupHours: 2, primaryCycleSec: 180, secondaryMachine: 'Haas VF2', secondarySetupHours: 0.5, secondaryCycleSec: 36 };
  const h = calculatorHours('machining', { basis: 'calculator', inputs }, [100]);
  assert.ok('cells' in h);
  assert.deepEqual(h.cells.map((c) => [c.workCell, c.at[0]?.setupHours, c.at[0]?.runHours, c.at[0]?.hours]), [['A20', 2, 5, 7], ['Haas VF2', 0.5, 1, 1.5]]);
  const same = calculatorHours('machining', { basis: 'calculator', inputs: { ...inputs, secondaryMachine: 'A20' } }, [100]);
  assert.ok('cells' in same);
  assert.deepEqual(same.cells.map((c) => [c.workCell, c.at[0]?.hours]), [['A20', 8.5]], 'both operations on one machine add up');
});

test('Assembly hours: the steps\' seconds an assembly times pieces, not rounded as the price is', () => {
  const h = calculatorHours('assembly', { basis: 'calculator', detail: { assemblySec: 600, testSec: 120, qaSec: 30 } }, [10, 1000]);
  assert.ok('cells' in h);
  assert.deepEqual(h.cells.map((c) => [c.workCell, c.at.map((a) => a.hours)]), [['Assembly', [2.08, 208.33]]]);
});

test('no hours: not priced, priced by hand or from a vendor, or bought', () => {
  assert.deepEqual(calculatorHours('metals', null, [100]), { reason: 'not priced yet' });
  assert.deepEqual(calculatorHours('molding', { basis: 'manual' }, [100]), { reason: 'priced by hand, not with the calculator' });
  assert.deepEqual(calculatorHours('procurement', { basis: 'calculator' }, [100]), { reason: 'bought, not made at Mack' });
  const metals = calculatorHours('metals', { basis: 'calculator', inputs: { operations: [{ workCell: 'Laser', setupHours: 0.5, runMinutesPerPiece: 3 }] } }, [100]);
  assert.ok('cells' in metals && metals.setupIncluded);
  assert.deepEqual(metals.cells[0]?.at[0]?.hours, 5.5);
});
