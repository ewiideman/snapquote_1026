-- SnapQuote, rebuilt. One schema for people and sign-in (app), one for quotes (quote), one for the
-- reference data the department calculators read (pricing).
--
-- A quote is kept as rows, not as one JSON document: lines, files, requests to departments, prices
-- and vendor quotes each have a table, so the board, the estimator queue and the send page can
-- ask for what they need without loading whole quotes. Nothing a person entered is deleted: rows are
-- removed (removed_at) or superseded (superseded_at), and every change is in app.audit_event.

-- ---------------------------------------------------------------- people

CREATE TABLE app.user_account (
  id                    text PRIMARY KEY,
  display_name          text NOT NULL,
  -- sales: business development. estimator: prices quotes for one department.
  -- manager: sees and does everything a salesperson and estimator do. administrator: also accounts and rates.
  role                  text NOT NULL CHECK (role IN ('sales', 'estimator', 'manager', 'administrator')),
  department            text CHECK (department IN ('metals', 'procurement', 'molding', 'machining', 'assembly')),
  email                 text,
  password_hash         text,
  must_change_password  boolean NOT NULL DEFAULT false,
  password_changed_at   timestamptz,
  disabled_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'estimator' OR department IS NOT NULL)
);

CREATE TABLE app.session (
  token_sha256  text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES app.user_account(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  ended_reason  text,
  CHECK (expires_at > created_at),
  CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);
CREATE INDEX session_user_idx ON app.session (user_id) WHERE ended_at IS NULL;

CREATE TABLE app.audit_event (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     text REFERENCES app.user_account(id),
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_event_entity_idx ON app.audit_event (entity_type, entity_id, at);

-- ---------------------------------------------------------------- quotes

CREATE SCHEMA quote;

CREATE TABLE quote.customer (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL CHECK (btrim(name) <> ''),
  -- Domains seen on this customer's RFQ emails, so the next email from them suggests the customer.
  email_domains  text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_name_idx ON quote.customer (lower(btrim(name)));

-- Quote numbers run per year: Q26-0001, Q26-0002, ...
CREATE TABLE quote.number_counter (
  year  int PRIMARY KEY,
  last  int NOT NULL
);

CREATE TABLE quote.quote (
  id               bigserial PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  revision         int NOT NULL DEFAULT 0,
  customer_id      bigint REFERENCES quote.customer(id),
  title            text NOT NULL DEFAULT '',
  contact_name     text,
  contact_email    text,
  rfq_received_on  date,
  customer_due_on  date,
  owner_id         text NOT NULL REFERENCES app.user_account(id),
  -- Quantity breaks, in assemblies (the quantity the customer orders). A line's quantity per assembly
  -- turns an assembly break into the line's own quantity.
  quantities       int[] NOT NULL DEFAULT '{}' CHECK (0 < ALL (quantities)),
  itar             boolean NOT NULL DEFAULT false,
  notes            text NOT NULL DEFAULT '',
  -- draft: business development is putting it together. estimating: with the departments.
  -- sent: the customer has it. won / lost / no_bid: closed.
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'estimating', 'sent', 'won', 'lost', 'no_bid')),
  -- From the RFQ email, when the quote was started from one: subject, sender, date.
  source_email     jsonb,
  sent_at          timestamptz,
  closed_at        timestamptz,
  close_reason     text,
  po_number        text,
  award_amount     numeric(14, 2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_status_idx ON quote.quote (status, updated_at DESC);

CREATE TABLE quote.line (
  id            bigserial PRIMARY KEY,
  quote_id      bigint NOT NULL REFERENCES quote.quote(id),
  position      int NOT NULL,
  part_number   text NOT NULL DEFAULT '',
  revision      text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  qty_per       numeric(14, 4) NOT NULL DEFAULT 1 CHECK (qty_per > 0),
  -- The line's own quantities, in pieces, when the customer asks for this part at its own breaks.
  -- Empty: the quote's assembly breaks times the quantity per assembly.
  quantities    numeric(14, 2)[] NOT NULL DEFAULT '{}' CHECK (0 < ALL (quantities)),
  -- The department that prices this line.
  department    text CHECK (department IN ('metals', 'procurement', 'molding', 'machining', 'assembly')),
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz
);
CREATE INDEX line_quote_idx ON quote.line (quote_id) WHERE removed_at IS NULL;

-- Files are kept on this server's disk (STORAGE_DIR), named by their SHA-256, never in the database.
CREATE TABLE quote.attachment (
  id            bigserial PRIMARY KEY,
  quote_id      bigint NOT NULL REFERENCES quote.quote(id),
  line_id       bigint REFERENCES quote.line(id),
  file_name     text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL,
  sha256        text NOT NULL,
  -- upload: dropped in by a person. email: came out of a dropped RFQ email.
  source        text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'email')),
  uploaded_by   text NOT NULL REFERENCES app.user_account(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz
);
CREATE INDEX attachment_quote_idx ON quote.attachment (quote_id) WHERE removed_at IS NULL;

-- One request per department a quote needs prices from.
CREATE TABLE quote.request (
  id            bigserial PRIMARY KEY,
  quote_id      bigint NOT NULL REFERENCES quote.quote(id),
  department    text NOT NULL CHECK (department IN ('metals', 'procurement', 'molding', 'machining', 'assembly')),
  -- open: the department is working on it. question: it is waiting on business development.
  -- answered: every line is priced. withdrawn: the quote no longer needs this department.
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'question', 'answered', 'withdrawn')),
  assignee_id   text REFERENCES app.user_account(id),
  -- When business development needs the department's prices by.
  needed_by     date,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  sent_by       text NOT NULL REFERENCES app.user_account(id),
  answered_at   timestamptz,
  answered_by   text REFERENCES app.user_account(id)
);
CREATE UNIQUE INDEX request_one_per_department ON quote.request (quote_id, department) WHERE status <> 'withdrawn';
CREATE INDEX request_department_idx ON quote.request (department, status);

-- The conversation on a quote: notes, a department's question, business development's answer.
CREATE TABLE quote.message (
  id          bigserial PRIMARY KEY,
  quote_id    bigint NOT NULL REFERENCES quote.quote(id),
  department  text,
  author_id   text NOT NULL REFERENCES app.user_account(id),
  kind        text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'question', 'answer', 'event')),
  body        text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_quote_idx ON quote.message (quote_id, at);

-- A department's price for a line: a unit price per quantity break, how it was reached, and the
-- one-time costs (tooling, NRE) quoted separately. A new estimate supersedes the line's previous one.
CREATE TABLE quote.estimate (
  id               bigserial PRIMARY KEY,
  line_id          bigint NOT NULL REFERENCES quote.line(id),
  department       text NOT NULL,
  basis            text NOT NULL CHECK (basis IN ('calculator', 'vendor_quote', 'manual')),
  one_time_cost    numeric(14, 2) NOT NULL DEFAULT 0 CHECK (one_time_cost >= 0),
  one_time_label   text NOT NULL DEFAULT '',
  lead_time_weeks  numeric(6, 1) CHECK (lead_time_weeks >= 0),
  notes            text NOT NULL DEFAULT '',
  -- What the estimator entered (calculator inputs, the vendor quote chosen) and what it produced.
  inputs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  entered_by       text NOT NULL REFERENCES app.user_account(id),
  entered_at       timestamptz NOT NULL DEFAULT now(),
  superseded_at    timestamptz
);
CREATE UNIQUE INDEX estimate_current_idx ON quote.estimate (line_id) WHERE superseded_at IS NULL;

-- Unit price per piece at a quantity of the line, in pieces.
CREATE TABLE quote.estimate_price (
  estimate_id  bigint NOT NULL REFERENCES quote.estimate(id),
  quantity     numeric(14, 2) NOT NULL CHECK (quantity > 0),
  unit_price   numeric(14, 4) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (estimate_id, quantity)
);

-- Business development's own price for a line at one quantity, with the reason. Cleared, not deleted.
CREATE TABLE quote.price_override (
  id          bigserial PRIMARY KEY,
  line_id     bigint NOT NULL REFERENCES quote.line(id),
  quantity    numeric(14, 2) NOT NULL CHECK (quantity > 0),
  unit_price  numeric(14, 4) NOT NULL CHECK (unit_price >= 0),
  reason      text NOT NULL CHECK (btrim(reason) <> ''),
  set_by      text NOT NULL REFERENCES app.user_account(id),
  set_at      timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz
);
CREATE UNIQUE INDEX price_override_current_idx ON quote.price_override (line_id, quantity) WHERE cleared_at IS NULL;

-- ---------------------------------------------------------------- procurement

CREATE TABLE quote.supplier (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supplier_name_idx ON quote.supplier (lower(btrim(name)));

CREATE TABLE quote.vendor_quote (
  id               bigserial PRIMARY KEY,
  line_id          bigint NOT NULL REFERENCES quote.line(id),
  supplier_id      bigint NOT NULL REFERENCES quote.supplier(id),
  reference        text NOT NULL DEFAULT '',
  moq              numeric(14, 2),
  lead_time_weeks  numeric(6, 1),
  tooling          numeric(14, 2) NOT NULL DEFAULT 0,
  nre              numeric(14, 2) NOT NULL DEFAULT 0,
  notes            text NOT NULL DEFAULT '',
  entered_by       text NOT NULL REFERENCES app.user_account(id),
  entered_at       timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz
);
CREATE INDEX vendor_quote_line_idx ON quote.vendor_quote (line_id) WHERE removed_at IS NULL;

-- A vendor's price at a quantity of the part (not of the assembly).
CREATE TABLE quote.vendor_quote_price (
  vendor_quote_id  bigint NOT NULL REFERENCES quote.vendor_quote(id),
  quantity         numeric(14, 2) NOT NULL CHECK (quantity > 0),
  unit_cost        numeric(14, 4) NOT NULL CHECK (unit_cost >= 0),
  PRIMARY KEY (vendor_quote_id, quantity)
);

-- ---------------------------------------------------------------- reference data for the calculators

CREATE SCHEMA pricing;

-- Rates, work cells and materials, by department and kind (for example metals / work_cell / L72).
-- Seeded from the old SnapQuote's tables; changed by administrators; every change audited.
CREATE TABLE pricing.reference (
  department  text NOT NULL,
  kind        text NOT NULL,
  key         text NOT NULL,
  data        jsonb NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  updated_by  text REFERENCES app.user_account(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department, kind, key)
);
