// Starts SnapQuote: API and UI on one port, on this server.
import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { openDatabase, runCli } from '../cli/common.ts';
import { administratorCanSignIn } from '../persistence/accounts.ts';
import { startExchange } from './exchangeTimer.ts';
import { makeMailer, startMail } from './mailTimer.ts';

await runCli(async () => {
  const config = loadConfig();
  const db = await openDatabase();
  mkdirSync(config.storageDir, { recursive: true });
  // The Production Scheduler link (MACK_EXCHANGE_DIR): quotes.json out, capacity.json in.
  const exchange = config.exchangeDir ? startExchange(db, config.exchangeDir) : undefined;
  // Quote emails through Mack's mail relay (SMTP_HOST); without it they wait, queued.
  const mail = config.mail ? startMail(db, makeMailer(config.mail), config.appUrl) : undefined;
  const server = createApp(db, { sessionHours: config.sessionHours, storageDir: config.storageDir, exchangeDir: config.exchangeDir, ...(exchange ? { exchange } : {}) }).listen(config.port, config.host, (err?: Error) => {
    if (err) {
      console.error(`Could not listen on http://${config.host}:${config.port}: ${err.message}`);
      process.exit(1);
    }
    const loopback = config.host === '127.0.0.1' || config.host === 'localhost' || config.host === '::1';
    console.log(`SnapQuote → ${loopback ? `http://${config.host}:${config.port}` : `http://<this server's address>:${config.port}`}`);
    console.log(`Database: ${config.databaseUrlRedacted}`);
    console.log(`Files: ${config.storageDir}`);
    console.log(config.mail ? `Email: through ${config.mail.host}:${config.mail.port}${config.appUrl ? `, links to ${config.appUrl}` : ' (set APP_URL for links)'}` : 'SMTP_HOST is not set: quote emails are queued, not sent.');
    console.log(config.exchangeDir ? `Production Scheduler exchange: ${config.exchangeDir}` : 'MACK_EXCHANGE_DIR is not set: no link to the Production Scheduler.');
  });
  if (!(await administratorCanSignIn(db))) {
    console.log('No administrator can sign in yet. On this server, run:');
    console.log('  npm run user -- add <username> "<Full Name>" administrator');
  }
  const stop = async () => {
    exchange?.stop();
    mail?.stop();
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
});
