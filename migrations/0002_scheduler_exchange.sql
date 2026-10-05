-- The link to the Production Scheduler (Eric Wiideman, Oct 5, 2026).
--
-- Metals work cells are named by the rate sheet here and by XA facility in the scheduler. Chris Glaski
-- ties each work cell to its facilities. An empty list is his answer that the work cell is not a
-- scheduled facility; no row means nobody has said yet. Replaced, not edited in place: each change is audited.
CREATE TABLE pricing.work_cell_facility (
  department  text NOT NULL,
  work_cell   text NOT NULL,
  facilities  text[] NOT NULL,
  set_by      text NOT NULL REFERENCES app.user_account(id),
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department, work_cell)
);

-- The quantity the customer ordered, recorded when the quote is won, so the scheduler sees the work at
-- that quantity rather than at every quantity quoted.
ALTER TABLE quote.quote ADD COLUMN ordered_quantity int CHECK (ordered_quantity > 0);
