// Starts SnapQuote: API and UI on one port, on this server.
import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { openDatabase, runCli } from '../cli/common.ts';
import { administratorCanSignIn } from '../persistence/accounts.ts';

await runCli(async () => {
  const config = loadConfig();
  const db = await openDatabase();
  mkdirSync(config.storageDir, { recursive: true });
  const server = createApp(db, { sessionHours: config.sessionHours, storageDir: config.storageDir }).listen(config.port, config.host, (err?: Error) => {
    if (err) {
      console.error(`Could not listen on http://${config.host}:${config.port}: ${err.message}`);
      process.exit(1);
    }
    const loopback = config.host === '127.0.0.1' || config.host === 'localhost' || config.host === '::1';
    console.log(`SnapQuote → ${loopback ? `http://${config.host}:${config.port}` : `http://<this server's address>:${config.port}`}`);
    console.log(`Database: ${config.databaseUrlRedacted}`);
    console.log(`Files: ${config.storageDir}`);
  });
  if (!(await administratorCanSignIn(db))) {
    console.log('No administrator can sign in yet. On this server, run:');
    console.log('  npm run user -- add <username> "<Full Name>" administrator');
  }
  const stop = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
});
