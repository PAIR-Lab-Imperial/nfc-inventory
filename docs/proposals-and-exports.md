# Equipment proposals and exports

## Member proposals

The public catalogue includes a **Propose equipment** form. A member selects their
name, describes the requirement and may add up to eight purchasing options. Each
option has a name and product URL, with optional supplier, price, currency and
notes. No member login is required.

New submissions start in `proposed`. An administrator opens **Proposals** in the
dashboard, reviews the links and records one of these states:

- `proposed`: under consideration;
- `ordered`: an option has been selected and ordered;
- `received`: the received item has also been linked to its equipment record.

The workflow is informational. It does not place orders or contact suppliers.

## Inventory workbook

The administrator **Exports** module downloads an `.xlsx` workbook using the same
five-sheet format accepted by the importer. It contains categories, equipment,
bundle contents and members, including inactive records. Use it as a reviewed
snapshot or as the starting point for a later bulk import.

The workbook intentionally omits reservations, checkouts, NFC token hashes,
proposals and audit events. Those records have different retention and security
needs and are included in the operational JSON export instead.

## Operational JSON

The protected operational export contains the administrator inventory dataset,
reservations, checkout history, recoverable NFC scan URLs, proposals, audit
events and backup-run evidence. It never includes the administrator password or
session-signing material. Anyone with a scan URL can resolve its equipment page,
just as they could by reading the physical tag, so protect the export.

Treat downloaded exports as controlled lab data. Store them in an approved
location and do not commit them to this public repository.
