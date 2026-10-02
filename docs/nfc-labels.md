# NFC labels

## Temporary pilot identifiers

The current pilot assigns one deterministic dummy token to every imported item:

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

Dummy tokens are suitable for interface and scanning tests. Do not permanently
lock a physical tag containing one; generate a random replacement first.

## Writing an NTAG213 sticker with a phone

Use an NFC-writing app that supports NDEF URL records, such as NFC Tools:

1. Find the equipment row in `outputs/dummy-nfc-labels.csv`.
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
rewritable during the pilot. NFC write-locking is irreversible and should only
be considered after the random production URLs have been deployed and checked.

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

For a temporary deterministic replacement during the pilot, explicitly supply
a new dummy token:

```bash
npm run nfc:create-label -- --asset-code ROB-003 --previous-status lost --token demo-rob-003-v2
```

Never reuse a token for a different item, publish a production manifest, or
commit generated URL files. The administrator NFC labels module creates or
replaces an association and retains its scan URL for authenticated viewing,
copying and protected operational exports. Use the command-line workflow for
controlled bulk preparation or recovery work.
