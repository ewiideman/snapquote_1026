-- Email when something on a quote needs someone (Eric Wiideman, Oct 5, 2026): a department gets a
-- quote or has one handed back, business development gets prices back or a question. Written in the
-- same transaction as the change that causes it, then sent through Mack's mail relay by the server, so
-- a change never waits on email and an email is never sent for a change that did not happen.
ALTER TABLE app.user_account ADD COLUMN email_notifications boolean NOT NULL DEFAULT true;

CREATE TABLE app.notification (
  id          bigserial PRIMARY KEY,
  to_user     text NOT NULL REFERENCES app.user_account(id),
  quote_id    bigint REFERENCES quote.quote(id),
  kind        text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- queued: waiting to go. sent. skipped: the person has no email address or turned email off.
  -- failed: the relay refused it after three tries.
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped', 'failed')),
  attempts    int NOT NULL DEFAULT 0,
  done_at     timestamptz,
  error       text
);
CREATE INDEX notification_queued_idx ON app.notification (created_at) WHERE status = 'queued';
