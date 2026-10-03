# Importing inventory data

The canonical round-trip workbook is
`data/templates/NFC_Inventory_Import_Template.xlsx`. It contains equipment,
bundle components, members and categories. Operational records such as NFC
labels, reservations and checkouts are not imported from this workbook.

## Safe workflow

1. Make a copy of the current workbook before editing it.
2. Keep the worksheet and column names unchanged.
3. Run `npm run inventory:validate`.
4. Resolve every error. Review warnings and confirm they are intentional.
5. Run `npm run inventory:build-sql` to create
   `outputs/inventory-import.sql` and its JSON validation report.
6. Test the import locally with `npm run db:seed:local`.
7. Back up production before a routine update.
8. Apply the validated file with `npm run db:seed:remote`.
9. Run `worker/queries/verify_seed.sql` against the target database and compare
   the counts with the validation report.

The generated SQL is upsert-only and safe to rerun. Matching categories,
members, equipment and bundle components are updated. Missing workbook rows do
not delete, retire or deactivate existing database records. This protects NFC,
reservation, checkout and audit history from accidental spreadsheet deletion.

Cloudflare applies SQL imports as uploaded files and returns the database to its
original state if an import fails. Do not add `BEGIN TRANSACTION` or `COMMIT` to
the generated file; Cloudflare's D1 import guidance requires those statements to
be omitted.

## Validation rules

- Asset codes are unique, use the category prefix and look like `ROB-001`.
- Required categories must exist in the Categories worksheet.
- Item type is `Individual` or `Bundle`.
- Lifecycle status is `Active`, `Maintenance`, `Missing` or `Retired`.
- Dates use a real Excel date, `dd/mm/yyyy` or `yyyy-mm-dd`.
- Prices are non-negative with no more than two decimal places. A currency code
  is required when a price is present.
- Bundle quantities are positive whole numbers and `required_on_return` is
  `Yes` or `No`.
- `photo_reference` is present on both Equipment and Bundle contents. It must
  be an HTTP or HTTPS URL. Use the maintained placeholder URL until a reviewed
  product or lab photograph is available.
- Usernames are unique and contain letters, numbers, dots, underscores or
  hyphens.

A bundle without component rows produces a warning rather than an error. This
allows incomplete legacy data to be loaded without inventing constituents. Add
the real components when they are known.

## File references

`manual_url` must be an HTTP or HTTPS address and is public. The primary photo
reference is also public. Certificate, receipt and record references are
admin-only and may contain either an HTTP/HTTPS address or a future storage key.

## Current canonical workbook

The maintained workbook currently contains 13 categories, 80 equipment units,
30 bundle-component rows and 7 active members. Run
`npm run inventory:validate` before every import; the checked-in workbook is
expected to complete with no errors or warnings. Counts will change as the lab
inventory is maintained, so validation output is the authoritative pre-import
summary.
