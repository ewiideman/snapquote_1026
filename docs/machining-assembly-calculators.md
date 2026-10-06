# The Machining and Assembly calculators

Both ported Oct 6, 2026 from the old SnapQuote (snapquote_master_0626 at 5920baa). Each is the one
calculation in the old app whose result reached a customer's quote. Dashboards, dead code and
half-built models were left behind.

## Machining

**Source**: `backend-postgres/lib/machined`, the "Machined Parts Workbook Baseline", derived from
"SNAPQUOTE EXCEL TEMPLATE.xlsx". The old app evaluated 31 formulas written as text. Here they are
written out in code with the same names and order (`src/pricing/machining/engine.ts`), so every line
of a break can be compared with the old engine. On the day of the port it was run side by side with
the old engine on 3,000 random parts: 279,000 values, every one identical. The workbook's own example
is in `tests/unit/machining.test.ts`, at the workbook's prices (cleaning 15 minutes) and at the
corrected baseline's (10 minutes, as the workbook's label says).

**What it works out**, for each quantity on the quote, every cost for that quantity divided by it:
- machining at the machine's rate, less the operator's $72 an hour for the share of time the machine
  runs unattended;
- setup;
- material: bar cost ÷ parts a bar, or a custom price, plus 20%;
- deburr, blast, cleaning and marking at $72 an hour;
- packaging;
- perishable tooling, a share of machining;
- programming, workholding, tooling and gaging, when they are spread over the parts;
- AQL inspection and the certificate of conformance;
- outside processing and assembly, each with a markup.

Programming, workholding, tooling and gaging that are not spread over the parts are the one-time
charge. Lead time is worked out and can be overridden.

**Where the numbers live**: 9 machines with their hourly rates, and 614 bars of stock (87 came over
with no cost and cannot be priced until one is entered), under Settings → Machining and Assembly rates.
The other rates (labor $72, programming $178, markups, minutes per batch, the AQL table) are settings
in `src/pricing/machining/settings.ts`, with no screen yet.

**Changed from the old app, on purpose**:
- **The operator-time share (duty cycle) is asked for.** The old engine took a blank as 0, a machine
  running unattended, and took $72 an hour off the rate without anyone choosing it.
- **The one-time charge is the non-amortized programming, fixtures and gages** (the workbook's own
  NRE). The old screen sent business development the setup and the amortized tooling as "totals",
  although both were already in the price, and never sent the real NRE.

**Questions for Machining**, kept exactly as the old engine had them until they answer:
1. Outside processing is a per-piece figure, yet it is divided by the quantity again, so it almost
   vanishes at larger quantities. Its shipping uses the per-piece cost, not the lot charge.
2. Assembly shipping is 6% of one piece's assembly cost per quantity, not per piece.
3. First article, capability study and gage R&R are worked out but in neither the price nor the
   one-time charge. The first-article figure has no rate in it (seconds × difficulty).
4. AQL inspection cost multiplies by the part's cycle time.
5. Only the first three outside operations are priced, but all their lead times count.

## Assembly

**Source**: the old Assembly screen's price, `computeAssemblyPolicyUnitCosts` in
`AssemblyDashboard.tsx`, over `assemblyLaborCalculations.ts` and `assemblyLaborCost.ts`. Its own
figures are in `tests/unit/assembly.test.ts`: 216 one-minute steps is $259.20, and the saved quote
MCK-033026-001 is $2.16 and $0.72.

**What it works out**: labor only, the same price at every quantity. For each section, every step's
assembly, test and QA seconds, times how many of that section go into one assembly. The total in
hours is rounded to hundredths, times the labor rate ($72, or the quote's own), rounded to the cent.
Equipment and tooling on the sections (Mack cost plus NRE) are the one-time charge.

**Not carried over**: material, scrap, markup and a units-per-hour entry. The old screen had the
calculation for them but no field to enter them, so no quote ever used them. Support labor, PFD,
utilization and molding seconds were shown on the old screen but never priced.

**Questions for Assembly**:
1. Hours are rounded to hundredths before the rate is applied, so the price moves in $0.72 steps and
   under 18 seconds is no price at all (the calculator says so; enter the price by hand).
2. Should the price carry PFD (0.85), utilization (0.917) or the support-labor percentages? The old
   screen showed them and priced without them.
3. Should material and purchased components be priced here, or by Procurement?
