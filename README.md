# PAIR Lab NFC Inventory

A maintainable, low-cost inventory and reservation system for PAIR Lab equipment.
Each physical unit or bundle is assigned a permanent asset code and a replaceable
NFC label. Scanning a label opens the public page for that equipment.

## Architecture

| Part | Service | Responsibility |
| --- | --- | --- |
| Public web app | GitHub Pages | Equipment catalogue, item pages, reservations and check-in/out forms |
| API | Cloudflare Worker | Validation, availability rules, administration and audit logging |
| Database | Cloudflare D1 | Equipment, members, labels, reservations, checkouts and proposals |
| File storage | Cloudflare R2 (later phase) | Photographs, receipts, certificates and other controlled files |

The browser never connects directly to D1 or receives administrator secrets.

## Repository layout

```text
web/                    Static GitHub Pages site
worker/                 Cloudflare Worker API
  migrations/           Ordered D1 schema migrations
data/templates/         Canonical import/export workbook
docs/                   Architecture and deployment documentation
.github/workflows/      Continuous deployment for GitHub Pages
```

## Current status

- [x] Canonical import/export workbook and cleaned initial inventory
- [x] Repository structure and initial D1 schema
- [x] Static site and Worker API scaffolds
- [x] Production D1 database and Worker foundation deployed
- [x] Validated workbook importer and initial production inventory seed
- [x] Public equipment catalogue and item record pages
- [x] NFC token resolution and temporary dummy-label manifest
- [x] Member reservations and equipment checkout/return
- [x] Password-protected administrator authentication and overview dashboard
- [x] Administrator equipment, bundle, member and NFC-label management
- [x] Public equipment and bundle-component photos, with source records and maintained placeholders where the model is ambiguous
- [ ] Proposal workflow, exports and automated backups
- [ ] NFC label generation and rollout

## Local development

Prerequisites: Node.js 20 or newer and a Cloudflare account for Worker/D1 work.

```bash
npm install
npm run db:migrate:local
npm run inventory:validate
npm run db:seed:local
npm run worker:dev
```

The static site can be served by any local HTTP server from `web/`. Its API URL
is configured in `web/config.js` and contains no secret.

Production foundation:

- Web: <https://pair-lab-imperial.github.io/nfc-inventory/>
- API: <https://pair-lab-nfc-inventory-api.pair-lab-nfc-inventory.workers.dev/>

Public catalogue routes:

- Catalogue: `/api/v1/equipment`
- Equipment record: `/api/v1/equipment/{asset-code}`
- NFC resolver: `/api/v1/nfc/{label-token}`
- Browser item page: `?item={asset-code}`
- NFC scan URL: `?t={label-token}`
- Administrator dashboard: `/admin.html`

See [docs/architecture.md](docs/architecture.md),
[docs/data-model.md](docs/data-model.md), and
[docs/importing.md](docs/importing.md) before changing inventory data. See
[docs/api.md](docs/api.md) for the public API and
[docs/deployment.md](docs/deployment.md) for production setup. The temporary
label manifest and phone-writing workflow are covered in
[docs/nfc-labels.md](docs/nfc-labels.md). Administrator credential setup and
rotation are covered in [docs/admin.md](docs/admin.md).

## Data handling

This is a public repository and GitHub Pages site. Never commit passwords,
Cloudflare tokens, receipts, certificates, personal contact details, database
exports, or production backups. Public equipment descriptions and member display
names must be reviewed before publication.
