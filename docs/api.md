# Public API

The Worker exposes read-only public catalogue routes under `/api/v1`. Responses
use JSON, disable caching so availability is not shown stale, and allow browser
requests from the PAIR Lab GitHub Pages origin.

## List equipment

`GET /api/v1/equipment`

Optional query parameters:

- `search`: matches asset code, name, manufacturer or model;
- `category`: exact category name, case-insensitive;
- `availability`: `free`, `reserved`, `in_use`, `maintenance`, `missing` or
  `retired`.

The response includes up to 100 equipment summaries and the active category
list. This covers the expected 50–100 item lab inventory without pagination.

## Equipment record

`GET /api/v1/equipment/{asset-code}`

The response includes public equipment metadata, current availability, the
current user when applicable, bundle contents, and current or upcoming active
reservations. It deliberately excludes administrator notes, purchase price,
supplier information, serial numbers, receipts, certificates and controlled
file records.

The browser uses `?item={asset-code}` for a shareable item page. NFC labels will
later use a random token rather than exposing the asset code as the label
credential.
