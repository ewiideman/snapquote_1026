# CLAUDE.md — SnapQuote (rebuild), current state

Read README.md first. This file is the rules and where things stand.

- State (2026-10-05, first build): **SnapQuote rebuilt from the bottom up** (Eric Wiideman, Oct 5:
  business development was not using SnapQuote_Master_0626; "build it better", without going back to
  them to re-explain their process). Jon Whitney (business development) owns the project.
  Stage 1 is built: drop-in RFQ (`.msg`, `.eml`, `.xlsx`, `.csv`), the board, department queues,
  Metals calculator, Procurement vendor quotes, manual prices for every department, business
  development's own prices with a reason, review and send, the customer's PDF, won/lost/no bid,
  revisions, accounts and Metals rates under Settings.
- **On-prem only. Period.** The app, PostgreSQL and attached files run on Mack's server. No cloud
  service, no outside API, no CDN at run time. Libraries are npm packages bundled at build.
- **American English** everywhere: code, comments, screens, docs.
- **Molding is priced through ADC** (the advanced development center); the screens say "Molding (ADC)".
  Its calculator (old `src/utils/calc.ts`, press and resin costing) is not ported yet: Molding prices
  by hand until it is.
- Metals engine: `src/pricing/metals/`, ported unchanged from SnapQuote_Master_0626 at 5920baa (MTL07
  model, rate sheet Rev F, 71 sheet-stock items). Its tests carry Mack's own workbook figures (Locus
  37-000542-00 and 37-001746-00, to 4 dp). Known oddities kept as-is and listed in the port report:
  setup divided by parts per assembly then by parts; freight mixes a yearly figure with a per-break
  one (defaults to $0); mass-costed material gets no 1.2 markup. Do not "fix" these without Metals.
  The calculator's tooling is spread over the parts, so a calculator estimate has no one-time charge.
- Quantities: a quote's quantities are assembly breaks; a part's pieces are break × quantity per
  assembly, unless the part has its own quantities (separate parts on one RFQ). Prices are per piece at
  the part's quantities. A missing price stays missing, never zero, and blocks sending.
- Nothing entered is deleted: lines and files are removed (`removed_at`), estimates and business
  development's prices superseded or cleared. Every write is in `app.audit_event`.
- Never: connect to the old SnapQuote's database (the migration runner refuses any database not named
  `snapquote_1026*`), write to XA, infer a price or a department, add a default for a business rule
  (markup, terms, validity) — those are settings an administrator enters.
- Ports: 3200 (3000/3003 are the old SnapQuote, 3100 the Production Scheduler, same server).
- Open: ITAR quotes are flagged but visible to everyone signed in (who may see them is Mack's call);
  no approval step before sending (add only if Mack asks); the Molding (ADC), Machining and Assembly
  calculators; importing customers and suppliers from the old SnapQuote; the link to the Production
  Scheduler (capacity check while quoting; open quotes as its quoted-work layer, register B-10);
  installing as a Windows service with NSSM like the scheduler (`docs/16` there).
- Libraries: Express 5, `pg`, exceljs, pdfkit, mailparser, @kenjiuno/msgreader; React + Vite in
  `src/ui`. Node ≥ 22.18 runs TypeScript directly: erasable syntax only, `.ts` import extensions.
  Install with `npm ci --include=dev` (`NODE_ENV=production` may be set).
- Verify with `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:browser`.
