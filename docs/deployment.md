# Deployment prerequisites

The repository scaffold does not create production services automatically. The
current foundation has now been deployed as described below.

Current production foundation:

- GitHub Pages: `https://pair-lab-imperial.github.io/nfc-inventory/`
- Worker API: `https://pair-lab-nfc-inventory-api.pair-lab-nfc-inventory.workers.dev/`
- D1 database: `pair-lab-nfc-inventory` in Western Europe
- Current inventory: 13 categories, 80 equipment units, 30 bundle components and 7 active members
- Public catalogue, member actions and NFC token resolution
- Production NFC associations: one random, replaceable association per equipment record

## 1. GitHub Pages

An organization or repository administrator must open **Settings → Pages** and
set the publishing source to **GitHub Actions**. The workflow at
`.github/workflows/pages.yml` publishes the contents of `web/` after changes are
merged to `main`.

Expected site URL:

```text
https://pair-lab-imperial.github.io/nfc-inventory/
```

## 2. Cloudflare Worker and D1

Install dependencies and authenticate Wrangler locally:

```bash
npm install
npx wrangler login
```

Create the D1 database:

```bash
npx wrangler d1 create pair-lab-nfc-inventory
```

Copy the returned database ID into `worker/wrangler.jsonc`, then validate locally:

```bash
npm run db:migrate:local
npm run worker:dev
```

When the local checks pass, apply the migration and deploy:

```bash
npm run db:migrate:remote
npm run worker:deploy
```

Configure both administrator credentials as encrypted Worker secrets. Do not add
their values to `worker/wrangler.jsonc`, GitHub, screenshots or documentation:

```bash
npx wrangler secret put ADMIN_USERNAME --config worker/wrangler.jsonc
npx wrangler secret put ADMIN_PASSWORD --config worker/wrangler.jsonc
```

For local development, copy `worker/.dev.vars.example` to the ignored
`worker/.dev.vars` file and replace both placeholders. Restart `wrangler dev`
after changing it.

Set the resulting Worker URL in `web/config.js`. This URL is public configuration,
not a secret.

## 3. Optional administrator image uploads

The uploader code is deployed safely behind an API feature flag. External image
URLs remain fully supported. To enable direct uploads, first activate R2 in the
Cloudflare dashboard and review the account's storage terms. Then create the
bucket:

```bash
npx wrangler r2 bucket create pair-lab-nfc-inventory-images --config worker/wrangler.jsonc
```

Add this top-level binding to `worker/wrangler.jsonc` after `d1_databases`:

```jsonc
"r2_buckets": [
  {
    "binding": "IMAGES",
    "bucket_name": "pair-lab-nfc-inventory-images"
  }
],
```

Run the tests and deploy the Worker. Confirm `/api/v1` reports
`features.imageUploads: true`, sign in to the administrator dashboard, upload a
small test photo and verify it appears in both the editor and public catalogue.
Do not enable the binding before the bucket exists, because Worker deployment
would fail while the current production version remains in place.

## 4. Production automation

The Worker workflow runs the full test suite and deploys changed API code after a
push to `main`. It safely skips deployment until the `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` repository secrets exist. The encrypted D1 backup workflow
also requires `BACKUP_PASSPHRASE`, runs weekly, and retains encrypted GitHub
Actions artifacts for 90 days. See `backups.md` for setup and restore testing.

## 5. NFC rollout gate

Do not permanently lock labels. Before mass-programming, confirm all of the following:

- the GitHub Pages URL is stable;
- the Worker token-resolution endpoint is deployed;
- the first inventory import has been verified;
- several unlocked pilot labels have been tested on both Android and iPhone;
- replacement of a lost label has been tested end to end.

Generate and apply the production associations with:

```bash
npm run nfc:build-production-batch
npx wrangler d1 execute pair-lab-nfc-inventory --remote \
  --config worker/wrangler.jsonc \
  --file outputs/nfc-production-batch/nfc-production-labels.sql --yes
```

See `docs/nfc-labels.md` before programming or replacing any sticker.
