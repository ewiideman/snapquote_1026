import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPACITY_FORMAT, metalsHours, readCapacityFile, workCellCapacity, type CapacityFile } from '../../src/quoting/exchange.ts';

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
    { code: '7/V85', name: 'V85', hoursPerWeek: 100, lateHours: 50, nextSixWeeksHours: 400, load: 0.75, caughtUpWeek: 2 },
    { code: '7/V130', name: 'V130', hoursPerWeek: 50, lateHours: 0, nextSixWeeksHours: 200, load: 0.67, caughtUpWeek: 0 },
    { code: '7/E18', name: 'E18', hoursPerWeek: 20, lateHours: 300, nextSixWeeksHours: 0, load: 2.5, caughtUpWeek: null },
  ] }],
};

test('a work cell of several facilities adds them; the latest catch-up week wins; one never caught up means never', () => {
  const c = workCellCapacity(file, 'metals', ['7/V85', '7/V130', '7/NOPE']);
  assert.equal(c.hoursPerWeek, 150);
  assert.equal(c.load, 0.72); // (50 + 600) / 900
  assert.equal(c.caughtUpWeek, 2);
  assert.deepEqual(c.unknown, ['7/NOPE']);
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
