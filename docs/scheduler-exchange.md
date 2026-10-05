# The exchange with the Production Scheduler

**Status (Oct 5, 2026): SnapQuote's side is built; the scheduler's is not.** Eric Wiideman: keep the
Production Scheduler separate for now. SnapQuote writes `snapquote/quotes.json` and reads
`scheduler/capacity.json` if one appears; until the scheduler writes it, SnapQuote shows hours without
the plant's load. This file is the agreed format for when the scheduler side is built.

SnapQuote and the Production Scheduler run on the same Mack server and are meant to tell each other two
things through files in one folder, `MACK_EXCHANGE_DIR`, set to the same path in both applications' `.env`.
Neither reads the other's database. Each file is written whole under a temporary name and then
renamed into place, so a reader never sees half of one. Each has a `format` and a `version`; a reader
that meets a version it does not know says so on screen instead of reading part of it.

```
MACK_EXCHANGE_DIR\
  scheduler\capacity.json    written by the scheduler, read by SnapQuote
  snapquote\quotes.json      written by SnapQuote, read by the scheduler
```

The formats are in `src/quoting/exchange.ts`. A change to them is made there and here together, and in
the scheduler once its side exists.

## scheduler/capacity.json — `mack.scheduler.capacity`, version 1

Written at start and within 10 minutes of any department's current schedule changing. One entry per
department with a real schedule; never the test data.

```json
{
  "format": "mack.scheduler.capacity", "version": 1, "writtenAt": "2026-10-05T15:02:11.000Z",
  "horizonWeeks": 12,
  "basis": "Hours are the schedule's: routing standard hours ÷ the facility's efficiency, ...",
  "departments": [{
    "key": "metals", "label": "Metals", "asOf": "2026-10-05T14:00:00.000Z", "scheduleName": "Metals — XA facilities",
    "facilities": [
      { "code": "7/V85", "name": "TRUMPF V85 CNC PRESS BRAKE", "efficiency": 0.85, "hoursPerWeek": 102, "lateHours": 61.5,
        "nextSixWeeksHours": 488.2, "load": 0.898, "caughtUpWeek": 2 }
    ]
  }]
}
```

- Figures are the Capacity & backlog page's capacity outlook, operating pattern **As in XA**.
- Hours are the schedule's clock hours: standard hours ÷ `efficiency`. A quote's standard hours are
  divided by the facility's `efficiency` before they are compared with them.
- `load` = (late + next six weeks) ÷ (hours a week × 6); null with no hours.
- `caughtUpWeek`: 0 nothing late; 1 this week; null not caught up within `horizonWeeks`.

## snapquote/quotes.json — `mack.snapquote.quotes`, version 1

Written every 10 minutes, at start, and at once when a quote is won. Quotes with the departments
(`estimating`), with the customer (`sent`), and won in the last `wonDays` (90) days. Drafts, lost
and no-bid quotes are left out.

```json
{
  "format": "mack.snapquote.quotes", "version": 1, "writtenAt": "...", "wonDays": 90,
  "quotes": [{
    "number": "Q26-0001", "revision": 0, "status": "won", "customer": "Acme Medical", "title": "Controller enclosure",
    "owner": "Jon Whitney", "itar": false, "customerDueOn": "2026-10-20", "sentAt": "...", "wonAt": "...",
    "quantities": [100, 500], "orderedQuantity": 500, "leadTimeWeeks": 6,
    "work": [
      { "department": "metals", "partNumber": "100-200", "workCell": "Trumpf V85 CNC Press Brake",
        "facilities": ["7/V85"], "pieces": [300, 1500], "hours": [3.25, 12.75], "ownQuantities": false }
    ],
    "withoutHours": [{ "department": "molding", "partNumber": "200-7", "reason": "no calculator in SnapQuote for this department yet" }]
  }]
}
```

- `quantities` are assembly breaks. `hours[i]` is at `quantities[i]` (`pieces[i]` pieces of the
  part), unless `ownQuantities`, when the part was quoted at its own quantities (`pieces`).
- Hours are standard hours from SnapQuote's Metals calculator: each operation's setup once, plus run
  minutes × pieces ÷ 60. Efficiency is not applied.
- `facilities`: the XA facilities Chris Glaski tied the work cell to in SnapQuote; `[]` he said it is
  not a scheduled facility; `null` not tied yet.
- `orderedQuantity`: the break the customer ordered, when business development recorded it on winning.

## How the scheduler would show it (not built)

Proposed: on its Capacity & backlog page, "Quoted work from SnapQuote", per facility of the department: won
hours and open hours (SnapQuote's standard hours ÷ the facility's efficiency), the weeks of the facility they represent, and each quote. Beside the schedule,
never added to it (B-10). A won quote counts at `orderedQuantity`, otherwise, like an open quote, at
the smallest quantity quoted; a work cell on several facilities shares its hours equally among them.
Work cells not tied yet, facilities outside the department, and parts without hours are listed.

## Setting it up on the server

1. Make a folder both services can write, for example `D:\MackExchange`.
2. Set `MACK_EXCHANGE_DIR=D:\MackExchange` in SnapQuote's `.env` and restart it (and in the
   scheduler's, once its side is built).
3. In SnapQuote, Chris Glaski ties each Metals work cell to its XA facilities (Work cells page). Until
   the scheduler writes `capacity.json`, he types the facility codes.
