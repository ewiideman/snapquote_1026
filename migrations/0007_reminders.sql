-- Reminders the working day before something is due (Eric Wiideman, Oct 22, 2026): a department's
-- prices by the date business development asked, and the quote by the customer's date. `about` names
-- what one reminds of (the department and date, or the date), so each is sent once; a date moved later
-- is reminded of again.
ALTER TABLE app.notification ADD COLUMN about text;
CREATE UNIQUE INDEX notification_once ON app.notification (to_user, kind, quote_id, about) WHERE about IS NOT NULL;
