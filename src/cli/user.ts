// Accounts from the server's command line, for the first administrator and for recovery.
//   npm run user -- add <username> "<Full Name>" <role> [department]
//   npm run user -- password <username>
//   npm run user -- list
import { createInterface } from 'node:readline/promises';
import { openDatabase, runCli } from './common.ts';
import { createAccount, listAccounts, ROLES, updateAccount } from '../persistence/accounts.ts';

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
    } else {
      throw new Error('Commands: add, password, list');
    }
  } finally {
    await db.close();
  }
});
