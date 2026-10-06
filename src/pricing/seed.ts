// Reference data a new database starts with. `npm run db:migrate` adds the rows a database does not
// have yet and never overwrites a rate an administrator has changed.
import { METALS_MATERIAL_ITEMS, METALS_WORK_CELLS } from './metals/seed.ts';
import { MOLDING_PRESSES, MOLDING_RESINS } from './molding/seed.ts';
import { MACHINING_MACHINES, MACHINING_STOCK } from './machining/seed.ts';

export const REFERENCE_SEED: { department: string; kind: string; key: string; data: unknown }[] = [
  ...METALS_WORK_CELLS.map((c) => ({ department: 'metals', kind: 'work_cell', key: c.name, data: c })),
  ...METALS_MATERIAL_ITEMS.map((m) => ({ department: 'metals', kind: 'material', key: m.itemNumber, data: m })),
  ...MOLDING_RESINS.map((r) => ({ department: 'molding', kind: 'resin', key: r.name, data: r })),
  ...MOLDING_PRESSES.map((p) => ({ department: 'molding', kind: 'press', key: p.id, data: p })),
  ...MACHINING_MACHINES.map((m) => ({ department: 'machining', kind: 'machine', key: m.name, data: m })),
  ...MACHINING_STOCK.map((m) => ({ department: 'machining', kind: 'stock', key: m.partNumber, data: m })),
];
