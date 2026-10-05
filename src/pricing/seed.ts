// Reference data a new database starts with. `npm run db:migrate` adds the rows a database does not
// have yet and never overwrites a rate an administrator has changed.
import { METALS_MATERIAL_ITEMS, METALS_WORK_CELLS } from './metals/seed.ts';

export const REFERENCE_SEED: { department: string; kind: string; key: string; data: unknown }[] = [
  ...METALS_WORK_CELLS.map((c) => ({ department: 'metals', kind: 'work_cell', key: c.name, data: c })),
  ...METALS_MATERIAL_ITEMS.map((m) => ({ department: 'metals', kind: 'material', key: m.itemNumber, data: m })),
];
