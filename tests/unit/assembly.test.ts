// The Assembly calculator against the old SnapQuote's own figures (src/utils/__tests__/assemblyLaborCost,
// assemblyPartsPerTopLevelPhase3 and the saved quote MCK-033026-001 at 5920baa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSEMBLY_DEFAULTS, assemblyProblems, priceAssembly, type AssemblySection } from '../../src/pricing/assembly/engine.ts';

const section = (seconds: number[], ppa: number | null = 1, equipment: [number | null, number | null][] = []): AssemblySection => ({
  name: 'Top level', partsPerAssembly: ppa, steps: seconds.map((s) => ({ label: '', assemblySec: s, testSec: null, qaSec: null })),
  equipment: equipment.map(([cost, nre]) => ({ label: '', cost, nre })),
});

test('"Bonnie and Clyde 2": 216 one-minute steps is 3.6 hours, $259.20 at $72', () => {
  const r = priceAssembly({ laborRatePerHour: null, sections: [section(Array(216).fill(60))] }, ASSEMBLY_DEFAULTS);
  assert.equal(r.hoursPerAssembly, 3.6);
  assert.equal(r.perUnit, 259.2);
  assert.equal(priceAssembly({ laborRatePerHour: 85, sections: [section(Array(216).fill(60))] }, ASSEMBLY_DEFAULTS).perUnit, 306);
  assert.equal(priceAssembly({ laborRatePerHour: null, sections: [section(Array(216).fill(60))] }, { laborRatePerHour: 80 }).perUnit, 288, "the quote's rate, else the administrator's");
});

test('the saved quote MCK-033026-001: 120 s is $2.16, 36 s is $0.72', () => {
  assert.equal(priceAssembly({ laborRatePerHour: 72, sections: [section([120])] }, ASSEMBLY_DEFAULTS).perUnit, 2.16);
  assert.equal(priceAssembly({ laborRatePerHour: 72, sections: [section([36])] }, ASSEMBLY_DEFAULTS).perUnit, 0.72);
});

test('parts per assembly multiply a section: 60 s at 2 is 120 s, 0.03 h', () => {
  const r = priceAssembly({ laborRatePerHour: 72, sections: [section([60], 2)] }, ASSEMBLY_DEFAULTS);
  assert.equal(r.assemblySec, 120);
  assert.equal(r.hoursPerAssembly, 0.03);
  assert.equal(priceAssembly({ laborRatePerHour: 72, sections: [section([60], 1 / 3)] }, ASSEMBLY_DEFAULTS).sections[0]?.partsPerAssembly, 0.33, 'rounded before it multiplies, as the workbook does');
});

test('test and QA seconds count; blank and negative entries do not', () => {
  const s: AssemblySection = { name: 'Top', partsPerAssembly: 1, equipment: [], steps: [
    { label: '', assemblySec: 600, testSec: 120, qaSec: 60 }, { label: '', assemblySec: -50, testSec: null, qaSec: Number.NaN },
  ] };
  const sub: AssemblySection = { name: 'Sub 1', partsPerAssembly: 2, equipment: [], steps: [{ label: '', assemblySec: 90, testSec: 30, qaSec: 0 }] };
  const r = priceAssembly({ laborRatePerHour: 72, sections: [s, sub] }, ASSEMBLY_DEFAULTS);
  assert.deepEqual([r.assemblySec, r.testSec, r.qaSec], [780, 180, 60]);
});

test('equipment and tooling on the sections are the one-time charge, Mack cost and NRE together', () => {
  const r = priceAssembly({ laborRatePerHour: 72, sections: [section([120], 1, [[1500, 250], [null, 99.995]])] }, ASSEMBLY_DEFAULTS);
  assert.equal(r.oneTimeUsd, 1850);
});

test('under 18 seconds rounds to no hours: no price, said plainly', () => {
  assert.throws(() => priceAssembly({ laborRatePerHour: 72, sections: [section([17])] }, ASSEMBLY_DEFAULTS), /rounds to 0.00 hours/);
  assert.deepEqual(assemblyProblems({ laborRatePerHour: null, sections: [section([])] }), ['Enter the seconds for at least one step.']);
});
