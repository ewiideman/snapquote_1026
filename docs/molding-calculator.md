# The Molding (ADC) calculator

Ported Oct 6, 2026 from the old SnapQuote (snapquote_master_0626 at 5920baa), `src/utils/calc.ts`:
ADC's "Tool Development Form" model, the one calculation in the old app whose result reached a
customer's quote. Formula for formula, with the same rounding. On the day of the port it was run side
by side with the old `calculatePartOutputs` and `selectPress` on 5,000 random parts, across all 46
resins and 53 presses; every output was identical. The old app's own test fixture is
`tests/unit/molding.test.ts`.

## What it works out

Per piece, the same at every quantity on the quote:

- **Material**: the whole shot (parts plus one runner) in pounds, shared by the cavities, × resin
  $/lb × 1.2 ÷ 0.95.
- **Press time**: the press's hourly rate ÷ parts an hour, where parts an hour =
  3600 ÷ cycle × cavities × 0.95.
- **Setup**: one setup's cost for the press × 4 setups a year ÷ the annual volume (EAU). Setup is
  spread over the year's volume, not over the quantity quoted, which is why the price does not change
  with quantity.

The mold is a one-time charge on the quote: domestic (worked out from tool size, steel, mold type,
gates, runner system, side actions, ejection and complexity), China at 40% of domestic and Portugal
at 90%, or ADC's own figure for any of them. ADC chooses which one goes on the quote, or none.

No markup, overhead or labor is added. The old calculator added none, and business development sets
its own price on the quote.

Also shown, as the form shows them: tonnage needed, shot as a share of the barrel, press days a year
and utilization, resin a year, and mold weight. With no press chosen, the calculator takes the
smallest press with the tonnage whose barrel suits the shot.

## Where the numbers live

- **Resins** (46, with $/lb and density) and **presses** (53, from the press list of Mar 21, 2025):
  rates an administrator keeps under Settings → Molding (ADC) rates. Two resins came over with no
  price (PSU - 30% GF, UHMWPE); a part in either cannot be priced until one is entered.
- **Press hourly rates, setup costs, steel rates and the other factors**: the form's, written as it
  wrote them (`src/pricing/molding/settings.ts`). An administrator can change them, but there is no
  screen for it yet.

## Questions for ADC

The old calculator's figures are kept exactly so that ADC's prices do not move without ADC deciding
it. These look wrong and should be put to ADC:

1. **The setup table has gaps.** A press in a gap gets a $94 setup, the smallest press's hourly
   rate, instead of a setup cost. The gaps are 151–199, 231–249, 451–499, 501–599, 651–699,
   751–799, 1001–1099, 1501–1699 and 2001–2099 tons. Presses on the list that fall in them:
   **1650 t** (two presses, including Arlington's 1, which the old app used when no press was
   chosen), 170 t and 240 t. The calculator says so on every part priced on one of them.
2. The 40–60 t setup is $94, the same as the hourly rate. Is that right?
3. A 400-ton press gets the 400–450 setup ($6,652), not the 350–400 one ($6,136), because of the
   order the form checks them in.
4. The form has a second, different setup table, used only for the cycle-time risk (for example
   500 t: $6,694 vs $6,312). Which is current?
5. Scrap is 5% in press time and 5% in material, and material also carries a fixed 20% adder. What
   is the 20%?
6. For a mold with more than one cavity, the length grows with the cavities but the width does not.
   An inserted hot runner adds nothing to the mold price.
7. The old admin screen had fields for markup, labor rate and overhead. No price ever used them.
   Should a Molding price carry any of them, or is that business development's to add?

## Not ported

- The risk scores (crane, platen, tonnage, cycle time and so on). They never touched the price.
- The ADC dashboard's sample figures and a second labor-and-overhead model in the old app. Neither
  produced a customer price.
- Family tools (several parts in one mold).
