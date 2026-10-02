# NFC labels

## Production identifiers

Production tags use one random, URL-safe token per equipment record. The raw
token is stored only in the ignored production batch and the protected
administrator export; D1 resolves a SHA-256 hash and never needs to expose the
token publicly outside its scan URL.

Generate a complete production batch from the canonical workbook with:

```bash
npm run nfc:build-production-batch
```

The command validates the workbook, generates a unique random URL for every
item, checks each NDEF URL against the 144-byte NTAG213 user-memory limit, and
creates these controlled files under `outputs/nfc-production-batch/`:

- `nfc-production-labels.sql`: D1 associations that retire any previous active
  label and activate this batch;
- `nfc-production-labels.json`: the recoverable batch manifest;
- `nfc-rollout-checklist.csv`: the programming and verification checklist;
- `nfc-label-sheet.html`: printable labels with QR fallbacks.

Do not run the generator again after deploying a batch unless every tag is to
receive a new URL. The command refuses to overwrite an existing batch by
default. Use `--reuse-existing --force` only to rebuild its SQL or printable
files from the same manifest.

Apply the SQL after taking a D1 backup:

```bash
npx wrangler d1 execute pair-lab-nfc-inventory --remote \
  --config worker/wrangler.jsonc \
  --file outputs/nfc-production-batch/nfc-production-labels.sql --yes
```

All generated production files contain working scan URLs. Keep them out of the
repository and remove unnecessary working copies from shared computers.

## Why earlier URLs contained `demo`

The original pilot used deterministic identifiers so interface and phone-scan
testing could be repeated before committing to a final batch:

```text
demo-<lowercase-asset-code>-v1
```

For example, `ROB-003` uses this NFC URL:

```text
https://pair-lab-imperial.github.io/nfc-inventory/?t=demo-rob-003-v1
```

Generate the complete programming manifest and idempotent D1 seed file with:

```bash
npm run nfc:build-dummy-labels
```

The command creates two ignored local files:

- `outputs/dummy-nfc-labels.csv`: asset codes, equipment names and URLs to write;
- `outputs/dummy-nfc-labels.sql`: hashed associations for D1.

Those associations are now historical. They are retained in D1 with status
`replaced` for audit purposes and no longer resolve. Dummy tokens remain useful
only in automated tests or a disposable local database.

## Legacy pilot rollout pack

After the canonical workbook is current, generate the printable labels and the
per-item programming checklist:

```bash
npm run nfc:build-rollout-pack
```

The command validates that every encoded URL fits the 144-byte NTAG213 user
memory and creates two ignored local files under `outputs/nfc-rollout-pack/`:

- `nfc-label-sheet.html`: A4 cut-line labels containing the asset code, equipment
  name and a QR fallback for the same URL stored on the NFC tag;
- `nfc-rollout-checklist.csv`: programming, placement and Android/iPhone/QR test
  fields for every item.

Open the HTML file in a browser and print at **100% scale**. The pilot labels are
explicitly marked **KEEP REWRITABLE** because they still use dummy identifiers.
Generated rollout files contain working tag URLs and must not be committed.

The earlier pilot pack can still be rebuilt for a disposable test database. For
an already deployed production batch, a protected administrator operational
export can recreate printable labels from the stored scan URLs:

```bash
npm run nfc:build-rollout-pack -- \
  --operational-export "PAIR-Lab-Operations-YYYY-MM-DD.json" \
  --output-dir outputs/nfc-production-pack
```

The production labels omit the pilot warning. Reprogram each tag, replace its QR
label, and repeat both phone tests. The operational export and generated pack are
controlled files: keep them out of the repository and delete working copies from
shared computers after the rollout is recorded.

## Writing an NTAG213 sticker with a phone

Use an NFC-writing app that supports NDEF URL records, such as NFC Tools:

1. Find the equipment row in `outputs/nfc-production-batch/nfc-rollout-checklist.csv`.
2. In the app, choose **Write**, add a **URL/URI** record, and paste only that
   row's `nfc_url` value.
3. Hold the phone over the sticker until the app confirms the write.
4. Scan the sticker normally and confirm it opens the correct asset page.
5. Print the asset code and a QR copy of the same URL on the visible label as a
   fallback for phones with NFC disabled.

Use the on-metal stickers for metal equipment and keep the tag away from battery
compartments, high-current cables, tight bends and places that are regularly
scraped. Test the final placement before applying every label in a batch.

Do not add a separate text record: one URL record is enough. Leave the tag
rewritable after programming. A production URL does not make a tag read-only;
only the NFC app's **Lock**, **Make read-only**, or password/protection operation
does that. Permanent NFC write-locking is irreversible and is not required by
this system.

## Replacing a lost or detached label

The equipment asset code remains unchanged. Generate a new random association:

```bash
npm run nfc:create-label -- --asset-code ROB-003 --previous-status lost
```

Use `replaced` instead of `lost` when the old sticker is still in hand. The
command writes an SQL update and a separate `.url.txt` file under `outputs/`.
The SQL stores the scan URL and its token hash, retires the previous active
association and records an audit event. Apply the SQL to D1, program the URL
from the text file, then scan-test the new sticker. The old URL will stop
resolving.

Never reuse a token for a different item, publish a production manifest, or
commit generated URL files. The administrator NFC labels module creates or
replaces an association and retains its scan URL for authenticated viewing,
copying and protected operational exports. Use the command-line workflow for
controlled bulk preparation or recovery work.
