# Architecture

## Boundaries

The system is split into a public static client and a stateful API. GitHub Pages
serves only HTML, CSS, JavaScript and other public assets. The Cloudflare Worker
owns all validation, database access, administrator authorization and audit
logging. D1 is never accessed directly from a browser.

```text
NFC tag or normal browser
          |
          v
GitHub Pages web app ---- HTTPS ----> Cloudflare Worker API
                                          |          |
                                          v          v
                                      D1 database   R2 files
```

## NFC identity

An NFC label stores a short URL of the form:

```text
https://pair-lab-imperial.github.io/nfc-inventory/?t=<random-token>
```

The raw token is generated with at least 128 bits of cryptographic randomness.
Only its hash and a short, non-secret hint are retained in D1. Replacing a lost
label creates a new label record and retires the old one; it does not modify the
equipment record or asset code.

## Availability rules

Availability is derived rather than manually edited:

1. Non-active lifecycle states take priority: maintenance, missing or retired.
2. An open checkout produces `in_use` and identifies the current member.
3. A reservation covering the current time produces `reserved`.
4. Otherwise the equipment is `free`.

Reservations are advisory and may overlap. A sharing flag and free-text note
make flexibility visible. The database prevents more than one open checkout for
the same unit, because the current holder must be unambiguous.

## Security and privacy

- Member accounts are not required; active members select or enter their username.
- Public forms are rate-limited and validated in the Worker.
- Administrator routes will be protected independently from the GitHub Pages site.
- Administrator-only files are served through short-lived authorized responses.
- Every administrator mutation and relevant public action creates an audit event.
- Secrets live in Cloudflare/GitHub secret stores, never in this repository.

The final administrator-authentication mechanism will be recorded in a separate
architecture decision before the admin interface is implemented.

## Public catalogue boundary

The public API returns only fields required to identify equipment, understand
its specifications and location, and see current use or reservations. It does
not return administrator notes, purchase prices, supplier details, serial
numbers, receipts, certificates or controlled file records. The browser performs
client-side catalogue filtering after one bounded read of at most 100 items.
