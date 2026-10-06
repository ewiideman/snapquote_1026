# Customers and suppliers from the old SnapQuote

The new SnapQuote never connects to the old one's database. Instead, the old customers and
suppliers are written out to two CSV files, read-only, and the new app reads those files.

## 1. Export from the old SnapQuote

On the server, in PowerShell. The old SnapQuote's database is `snapquote_db`, user `snapquote_user`
(its password is in the old app's `backend-postgres\.env`). Only `SELECT` is run; nothing in the old
database changes.

```
mkdir C:\snapquote-export -Force
& "C:\pgsql\bin\psql.exe" -h 127.0.0.1 -U snapquote_user -d snapquote_db -c "\copy (SELECT id::text, name, email, phone, address, city, state, zip_code, country, website, notes FROM customers UNION ALL SELECT NULL, btrim(customer_name), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'named on a quote only' FROM (SELECT DISTINCT customer_name FROM quotes WHERE deleted_at IS NULL AND customer_id IS NULL AND btrim(coalesce(customer_name, '')) <> '') q ORDER BY 2) TO 'C:/snapquote-export/customers.csv' WITH (FORMAT csv, HEADER, ENCODING 'UTF8')"
& "C:\pgsql\bin\psql.exe" -h 127.0.0.1 -U snapquote_user -d snapquote_db -c "\copy (SELECT * FROM suppliers ORDER BY name) TO 'C:/snapquote-export/suppliers.csv' WITH (FORMAT csv, HEADER, ENCODING 'UTF8')"
```

The customers file also carries customer names typed on old quotes that never became a customer
record. The files hold Mack's customer and supplier list: keep them on the server.

## 2. Look before adding

In the new SnapQuote's folder:

```
npm run import:directory -- --customers C:\snapquote-export\customers.csv --suppliers C:\snapquote-export\suppliers.csv
```

Nothing is changed. It lists, for each file:

- **would add**: one entry per name. Names are matched ignoring case and spacing, so
  `ACME MEDICAL` and `Acme  Medical` are one. A customer's email domains come along, so the
  next RFQ email from that company is recognized (shared mail services such as gmail are not).
- **already here**: names this app already has. They are left as they are.
- **rows not read**: rows with no name.
- **possibly the same company written two ways**: names that differ only in punctuation or a
  suffix such as Inc, LLC or Corp (`Acme Medical` / `Acme Medical, Inc.`). Both are added; nothing
  is merged without a person deciding. Say which to keep and the other can be retired later.

## 3. Add them

The same command with `--apply`. It runs in one transaction and is recorded in the audit trail
(`directory.imported`). Running it again adds nothing more.

Every old row is kept with the name it was added under (`imported`: address, phone, category,
payment terms, certifications and so on, exactly as exported), so nothing is lost even though the
new screens show only the name.
