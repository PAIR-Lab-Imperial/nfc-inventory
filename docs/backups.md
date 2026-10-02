# Automated database backups

The `Encrypted D1 backup` GitHub Actions workflow runs every Monday at 04:17 UTC
and can also be started manually. It exports the production D1 database,
compresses it, encrypts it with AES-256-CBC and PBKDF2, uploads only the encrypted
file as a private workflow artifact, and retains it for 90 days. Each attempt is
recorded in `backup_runs` for administrator visibility and operational auditing.

## Required repository secrets

An organization or repository administrator must add these under **Settings →
Secrets and variables → Actions**:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID;
- `CLOUDFLARE_API_TOKEN`: a narrowly scoped token that can read/export and execute
  SQL on the `pair-lab-nfc-inventory` D1 database and deploy the Worker;
- `BACKUP_PASSPHRASE`: a long unique passphrase kept in the lab's approved
  password manager.

Until all three exist, the scheduled job exits successfully without creating a
backup. After configuration, run the workflow manually once and confirm that the
artifact exists and the latest `backup_runs` row says `completed`.

## Restore drill

Download an encrypted artifact to a controlled computer and decrypt it without
putting the passphrase on the command line:

```bash
export BACKUP_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in BACKUP_ID.sql.gz.enc -out BACKUP_ID.sql.gz \
  -pass env:BACKUP_PASSPHRASE
gzip -d BACKUP_ID.sql.gz
```

Inspect the SQL and restore it to a newly created test D1 database first. Do not
overwrite production during a restore drill. Verify record counts and several
equipment, reservation and checkout records before considering the backup tested.
Run a restore drill after first configuration and at least twice per year.
