# Administrator access

The dashboard is available at:

```text
https://pair-lab-imperial.github.io/nfc-inventory/admin.html
```

It uses a separate administrator username and password. These credentials are
not related to the member names used for reservations and checkout.

## Where the credentials live

Production values are encrypted Cloudflare Worker secrets named
`ADMIN_USERNAME` and `ADMIN_PASSWORD`. They are not stored in D1, the browser
site, the repository or an export. Local development reads the same names from
the ignored `worker/.dev.vars` file; `worker/.dev.vars.example` documents the
required shape.

The password must contain at least twelve characters. Use a unique password from
the lab's approved password manager for real use. Production credentials are
already managed as Worker secrets; never copy them into repository files.

## Set or rotate production credentials

From an authenticated Wrangler installation in the repository root, run:

```bash
npx wrangler secret put ADMIN_USERNAME --config worker/wrangler.jsonc
npx wrangler secret put ADMIN_PASSWORD --config worker/wrangler.jsonc
```

Wrangler prompts for each value without putting it in shell history. Restarting
or redeploying the Worker is not required after `secret put`. Changing either
value invalidates all existing administrator sessions; the administrator signs
in again with the new pair.

To change local credentials, edit the ignored `worker/.dev.vars` file and restart
`npm run worker:dev`. Never copy live credentials into `.dev.vars.example`.

## Session and lockout behaviour

- Sessions expire four hours after login and live only in that browser tab's
  `sessionStorage`.
- Signing out removes the browser token immediately.
- Changing either credential invalidates already-issued tokens.
- Five incorrect attempts within fifteen minutes lock that client for fifteen
  minutes.
- Login responses never reveal whether the username or password was wrong.

The dashboard provides protected modules for equipment and bundle editing,
member maintenance, proposal review, exports, and NFC label creation or
replacement. New asset codes are suggested from the selected category's prefix
and next available number, but an administrator can edit the suggestion before
saving.

Equipment and every bundle component can use a separate public photo. The image
editor always accepts a reviewed HTTPS image URL and shows a preview. When the
Cloudflare `IMAGES` R2 binding is enabled, it also offers a file picker and phone
camera control for JPEG, PNG and WebP files up to 8 MB. The upload is completed
before the equipment record is saved, and the resulting permanent URL is filled
in automatically. Until R2 is enabled, the API advertises the feature as
unavailable and the dashboard keeps the URL workflow visible, so existing
maintenance is unaffected.

Each management table has local filters. Equipment can be searched and filtered
by category, type and live availability; members by active state; NFC labels by
programming state; and proposals by workflow status. Filters affect only the
current browser view and do not modify or export a subset of the stored records.

The availability override includes **Not yet unboxed** for equipment that has
arrived but is not ready for members. This state appears in the public catalogue
and blocks member reservations and checkout. An administrator changes it to
Available after the equipment has been unpacked and checked.

Each active NFC association also has a programming state. An administrator can
mark the label **Written** after programming the physical sticker, or return it
to **Not written** if the write needs to be repeated. The dashboard records when
the state changed and which administrator marked it. A replacement association
always starts as not written because it represents a new physical sticker.

When a label is created or replaced, its full NFC scan URL is stored with the
association and remains visible to authenticated administrators. The NFC labels
module can display and copy the active URL again, and the protected operational
export includes label URLs for reprinting and recovery.

The inventory export follows the canonical workbook format used by the importer.
The separate operational JSON export contains activity and audit history. See
`proposals-and-exports.md`; backup scheduling and restore testing are covered in
`backups.md`.
