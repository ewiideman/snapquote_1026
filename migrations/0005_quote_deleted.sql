-- Business development can delete a quote (Eric Wiideman, Oct 6, 2026). Nothing entered is erased:
-- a deleted quote is hidden from the board, the departments' queues and the scheduler, its open
-- requests are withdrawn, and it can be restored. A won quote is the record of an order and is
-- never deleted.
ALTER TABLE quote.quote ADD COLUMN deleted_at timestamptz;
ALTER TABLE quote.quote ADD COLUMN deleted_by text REFERENCES app.user_account(id);
ALTER TABLE quote.quote ADD COLUMN delete_reason text;
-- The requests the deletion withdrew, with the status each had, so a restore puts them back.
ALTER TABLE quote.quote ADD COLUMN deleted_requests jsonb;
ALTER TABLE quote.quote ADD CONSTRAINT quote_won_not_deleted CHECK (deleted_at IS NULL OR status <> 'won');
