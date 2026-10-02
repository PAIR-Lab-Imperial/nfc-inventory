# Deployment prerequisites

The repository scaffold does not create production services automatically. The
current foundation has now been deployed as described below.

Current production foundation:

- GitHub Pages: `https://pair-lab-imperial.github.io/nfc-inventory/`
- Worker API: `https://pair-lab-nfc-inventory-api.pair-lab-nfc-inventory.workers.dev/`
- D1 database: `pair-lab-nfc-inventory` in Western Europe
- Initial seed: 9 categories, 31 equipment units, 3 bundle components and 6 members
- Public catalogue, member actions and NFC token resolution
- Temporary NFC seed: one deterministic dummy association per equipment record

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

## 3. Production automation

The Worker workflow runs the full test suite and deploys changed API code after a
push to `main`. It safely skips deployment until the `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` repository secrets exist. The encrypted D1 backup workflow
also requires `BACKUP_PASSPHRASE`, runs weekly, and retains encrypted GitHub
Actions artifacts for 90 days. See `backups.md` for setup and restore testing.

## 4. NFC rollout gate

Do not permanently lock or mass-program labels until all of the following are true:

- the GitHub Pages URL is stable;
- the Worker token-resolution endpoint is deployed;
- the first inventory import has been verified;
- several unlocked pilot labels have been tested on both Android and iPhone;
- replacement of a lost label has been tested end to end.

Generate and apply the temporary pilot associations with:

```bash
npm run nfc:build-dummy-labels
npx wrangler d1 execute pair-lab-nfc-inventory --remote \
  --config worker/wrangler.jsonc --file outputs/dummy-nfc-labels.sql --yes
```

See `docs/nfc-labels.md` before programming or replacing any sticker.
