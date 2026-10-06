-- Customers and suppliers brought over from the old SnapQuote (Oct 6, 2026). The new app keeps only a
-- name (and, for a customer, the email domains its RFQs come from); the old row's other fields --
-- address, phone, category, payment terms, certifications -- are kept here as they were exported, so
-- nothing is lost and nothing is reinterpreted. Null for anyone added in this app.
ALTER TABLE quote.customer ADD COLUMN imported jsonb;
ALTER TABLE quote.supplier ADD COLUMN imported jsonb;
