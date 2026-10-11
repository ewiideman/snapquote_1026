// Accounts from the server's command line, for the first administrator and for recovery.
//   npm run user -- add <username> "<Full Name>" <role> [department]
//   npm run user -- password <username>
//   npm run user -- list
//   npm run user -- demo        one account per department to look around with; passwords shown once
//   npm run user -- demo off    switch those accounts off
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { openDatabase, runCli } from './common.ts';
import { createAccount, listAccounts, ROLES, updateAccount } from '../persistence/accounts.ts';
import { DEPARTMENTS } from '../quoting/departments.ts';

// Accounts for seeing SnapQuote as each department sees it: business development, then one estimator
// per department. Never for real work: the passwords are printed on the screen.
const DEMO = [
  { id: 'bd.demo', displayName: 'Business development (demo)', role: 'sales', department: null },
  ...DEPARTMENTS.map((d) => ({ id: `${d.key}.demo`, displayName: `${d.name} estimator (demo)`, role: 'estimator', department: d.key })),
];

async function ask(prompt: string): Promise<string> {
  const env = process.env['SNAPQUOTE_PASSWORD'];
  if (env) return env;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

await runCli(async () => {
  const [command, ...args] = process.argv.slice(2);
  const db = await openDatabase();
  try {
    if (command === 'add') {
      const [id, name, role, department] = args;
      if (!id || !name || !role) throw new Error(`Usage: npm run user -- add <username> "<Full Name>" <${ROLES.join('|')}> [department]`);
      const password = await ask('Password (at least 8 characters): ');
      const a = await createAccount(db, null, { id, displayName: name, role, department: department ?? null, password, temporary: false });
      console.log(`Added ${a.id} (${a.role}${a.department ? `, ${a.department}` : ''}).`);
    } else if (command === 'password') {
      const [id] = args;
      if (!id) throw new Error('Usage: npm run user -- password <username>');
      const password = await ask('New password (at least 8 characters): ');
      const admin = (await listAccounts(db)).find((a) => a.role === 'administrator' && a.id !== id);
      await updateAccount(db, admin?.id ?? id, id, { password });
      console.log(`Password set for ${id}; they choose their own at their next sign-in.`);
    } else if (command === 'list') {
      for (const a of await listAccounts(db)) console.log(`${a.id.padEnd(24)} ${a.displayName.padEnd(28)} ${a.role}${a.department ? ` (${a.department})` : ''}${a.canSignIn ? '' : '  — cannot sign in'}`);
    } else if (command === 'demo') {
      const accounts = await listAccounts(db);
      const admin = accounts.find((a) => a.role === 'administrator' && !a.disabledAt);
      if (args[0] === 'off') {
        for (const d of DEMO) if (accounts.some((a) => a.id === d.id && !a.disabledAt)) await updateAccount(db, admin?.id ?? d.id, d.id, { disabled: true });
        console.log('The demo accounts are switched off.');
        return;
      }
      console.log('Demo accounts, one per department (each password is shown only now):\n');
      for (const d of DEMO) {
        const password = randomBytes(9).toString('base64url');
        if (accounts.some((a) => a.id === d.id)) await updateAccount(db, admin?.id ?? d.id, d.id, { displayName: d.displayName, role: d.role, department: d.department, disabled: false, password, temporary: false });
        else await createAccount(db, null, { ...d, password, temporary: false });
        console.log(`  ${d.id.padEnd(20)} ${password}   ${d.displayName}`);
      }
      console.log('\nSign in with any of them on the sign-in page. Switch them off with: npm run user -- demo off');
    } else {
      throw new Error('Commands: add, password, list, demo');
    }
  } finally {
    await db.close();
  }
});
