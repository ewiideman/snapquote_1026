// Customers and suppliers from the old SnapQuote, from the CSV files exported from it
// (docs/import-from-old-snapquote.md). Shows what it would do; --apply does it.
//   npm run import:directory -- --customers customers.csv --suppliers suppliers.csv [--apply]
import { openDatabase, runCli } from './common.ts';
import { applyDirectoryImport, planFromFile } from '../persistence/directory.ts';
import type { DirectoryKind, DirectoryPlan } from '../quoting/directory.ts';

function report(plan: DirectoryPlan, applied: boolean): void {
  const kinds = plan.kind === 'customer' ? 'customers' : 'suppliers';
  console.log(`\n${kinds.toUpperCase()}: ${applied ? 'added' : 'would add'} ${plan.add.length}; ${plan.alreadyHere.length} already here; ${plan.skipped.length} rows not read.`);
  for (const e of plan.add) console.log(`  + ${e.name}${e.emailDomains.length ? `  (${e.emailDomains.join(', ')})` : ''}${e.imported.length > 1 ? `  [${e.imported.length} rows]` : ''}`);
  if (plan.alreadyHere.length) console.log(`  Already here, left as they are: ${plan.alreadyHere.join('; ')}`);
  for (const s of plan.skipped) console.log(`  ! row ${s.row}: ${s.reason}`);
  if (plan.nearDuplicates.length) {
    console.log(`  Possibly the same ${plan.kind} written two ways (both kept; decide which to use):`);
    for (const [a, b] of plan.nearDuplicates) console.log(`    ~ "${a}"  /  "${b}"`);
  }
}

await runCli(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const files: [DirectoryKind, string][] = [];
  for (const [flag, kind] of [['--customers', 'customer'], ['--suppliers', 'supplier']] as const) {
    const i = args.indexOf(flag);
    if (i >= 0) {
      const file = args[i + 1];
      if (!file || file.startsWith('--')) throw new Error(`${flag} needs a file name.`);
      files.push([kind, file]);
    }
  }
  if (!files.length) throw new Error('Usage: npm run import:directory -- --customers customers.csv --suppliers suppliers.csv [--apply]');
  const db = await openDatabase();
  try {
    for (const [kind, file] of files) report(apply ? await applyDirectoryImport(db, null, kind, file) : await planFromFile(db, kind, file), apply);
    console.log(apply ? '\nDone. Everything added is in the audit trail (directory.imported).' : '\nNothing was changed. Run again with --apply to add them.');
  } finally {
    await db.close();
  }
});
