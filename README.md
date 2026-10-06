# SnapQuote

Quoting for Mack Molding, from the customer's RFQ to the order. Business development drops the RFQ in,
the departments price their parts, business development reviews and sends the customer's copy, and
records whether it was won.

This is a rebuild of SnapQuote (`ewiideman/SnapQuote_Master_0626`) from the bottom up, started October
2026 because business development was not using the old one. It keeps the old SnapQuote's Metals
pricing engine and rates, and drops the rest.

**On-prem only.** The app, its PostgreSQL database and every attached file live on Mack's own server.
It calls no outside service.

## How a quote moves

1. **Start it by dropping the RFQ** on the board: the customer's email straight out of Outlook (`.msg`)
   or saved (`.eml`), a parts list or BOM spreadsheet (`.xlsx`, `.csv`), drawings, models. SnapQuote
   reads the email's sender, date, subject and text, attaches its files, and adds a part for every
   row of a parts list. A customer seen before is recognized by the sender's email domain.
2. **Put it together.** Name the customer, the quantities (assemblies), and who prices each part:
   Metals, Procurement, Molding (ADC), Machining or Assembly. Nothing else is required.
3. **Send it to the departments.** Each department sees it in its queue. Metals prices with its
   calculator, Procurement from vendor quotes, any department can type prices. A department can ask
   business development a question; the answer hands it back. Changing a part a department already
   priced hands that department the quote back.
4. **Review and send.** Every price on one page, per part and per quantity, with the price per
   assembly. Business development can set its own price with a reason. The customer's copy is a PDF.
5. **Record the outcome**: won (PO number, value), lost (why), or no bid. A revision reopens it.

## Email

SnapQuote emails a person when a quote needs them, and only then: a department when a quote arrives
or comes back to it after a change, business development when a department asks a question, answers
come back, prices come back, or every department has priced (ready to send). Nobody is emailed about
their own step. Mail goes through Mack's relay (`SMTP_HOST`); each person sets their address and can
turn the emails off under their name. Without a relay, emails wait in `app.notification`.

## The link to the Production Scheduler

SnapQuote's side is built; the scheduler's is not yet, and the scheduler is being kept separate for
now (`docs/scheduler-exchange.md`). Both apps run on Mack's server and are to share one folder,
`MACK_EXCHANGE_DIR`. Neither reads the other's database.

- **SnapQuote → scheduler:** every 10 minutes, and at once when a quote is won, SnapQuote writes
  `snapquote/quotes.json`. It holds quotes with the departments, with the customer, and won in the
  last 90 days, and for each Metals part priced with the calculator, the standard hours per work cell
  at each quantity, for the scheduler to show beside its schedule as quoted work, never added to it.
- **Scheduler → SnapQuote:** once built, the scheduler writes `scheduler/capacity.json`: each XA facility's hours
  a week, late work, the next six weeks and the week it is caught up. SnapQuote shows it in the Metals
  calculator and under "Can the plant make it?" on the review page.
- **Work cells:** the rate sheet's work cells are tied to XA facilities by Chris Glaski on the Work
  cells page. Nothing is matched by name; a work cell not tied yet says so.
- When a quote is won, business development records the quantity ordered, so the scheduler counts
  the work at that quantity.

## Run it

Requirements: Node.js 22.18 or later, PostgreSQL 14 or later.

```bash
npm ci --include=dev
cp .env.example .env          # then set DATABASE_URL, STORAGE_DIR, PORT
npm run db:migrate            # creates the tables and loads the Metals rates
npm run user -- add eric "Eric Wiideman" administrator
npm run build:ui
npm start                     # http://<server>:3200
```

The first administrator adds everyone else under Settings. Roles: **Business development** (quotes),
**Estimator** (one department's prices), **Manager** (both, every department), **Administrator** (also
people, rates and the terms printed on quotes).

Customers and suppliers from the old SnapQuote: `docs/import-from-old-snapquote.md`.

## Check it

```bash
npm run typecheck
npm test              # unit tests, including the ported Metals engine
npm run test:db       # a quote from RFQ email to won, through the API (resets TEST_DATABASE_URL)
npm run test:browser  # the same through the screens (resets TEST_DATABASE_URL)
```

## Where things are

- `src/quoting/`: what a quote is worth and what stops each step (pure), BOM reading, the PDF.
- `src/pricing/metals/`: the Metals engine (MTL07 model) and its seed rates, ported unchanged.
- `src/persistence/`: the database: quotes, files, procurement, reference data, accounts.
- `src/server/`: the HTTP API. `src/ui/`: the screens (React + Vite, plain CSS).
- `migrations/`: numbered SQL files; an applied migration is never edited.
