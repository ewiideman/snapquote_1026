-- Business development's adjustment to every price on a quote (Eric Wiideman, Oct 22, 2026): a percent
-- over the departments' prices, with the reason, instead of setting each part's price by hand. Kept as a
-- percent so a department's later change still flows through; a part's own price set by business
-- development wins over it. One-time charges are not adjusted. Each change is in app.audit_event.
ALTER TABLE quote.quote ADD COLUMN adjustment_pct numeric(7, 3) CHECK (adjustment_pct > -100 AND adjustment_pct <= 1000 AND adjustment_pct <> 0);
ALTER TABLE quote.quote ADD COLUMN adjustment_reason text;
ALTER TABLE quote.quote ADD COLUMN adjustment_set_by text REFERENCES app.user_account(id);
ALTER TABLE quote.quote ADD COLUMN adjustment_set_at timestamptz;
ALTER TABLE quote.quote ADD CONSTRAINT quote_adjustment_has_reason CHECK (adjustment_pct IS NULL OR (adjustment_reason IS NOT NULL AND adjustment_set_by IS NOT NULL));
