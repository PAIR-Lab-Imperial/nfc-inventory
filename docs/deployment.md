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

Set the resulting Worker URL in `web/config.js`. This URL is public configuration,
not a secret.

## 3. Production automation

Worker deployment, scheduled exports and R2 backups will be added only after the
Cloudflare account and administrator-authentication choice are confirmed. Their
credentials must be stored as GitHub Actions or Cloudflare secrets.

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
