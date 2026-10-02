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
the lab's approved password manager for real use. The current dummy credentials
are only for the implementation pilot and must be rotated before other people
are invited to the dashboard.

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

The first dashboard release is an authenticated overview. Equipment editing,
member maintenance, NFC replacement, import/export and backup controls will be
implemented as separate protected modules.
