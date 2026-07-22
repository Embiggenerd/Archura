# Deploy Core to Hetzner

This package runs a single Core instance, PostgreSQL, and Caddy on one Hetzner
server. Only Caddy publishes a host port. Core, Prometheus metrics, and
PostgreSQL remain on un-published Docker networks. Core retains outbound
connectivity for Stripe and other required APIs.

The Cloudflare Worker remains the application entry point and authenticates to
Core with `X-Archura-Service-Authorization`. Cloudflare Tunnel and Access are
not required for this deployment.

## 1. Prepare the server

Use a supported Linux distribution with Docker Engine and the Compose plugin.
Install the deployment package at:

```text
/opt/archura
```

For a Hetzner Cloud server, configure a stateful firewall:

- TCP 22 from administrator IPs only.
- TCP 443 from Cloudflare's published IPv4 and IPv6 ranges only.
- No public rules for 80, 8080, 9091, or 5432.

The firewall restriction prevents callers from bypassing Cloudflare and
reaching the origin IP directly.

## 2. Configure Cloudflare

Create a proxied DNS record such as `core.example.com` pointing to the Hetzner
server. Set the zone SSL mode to **Full (strict)**.

Create a Cloudflare Origin Certificate for that hostname and save its files as:

```text
deploy/hetzner/certs/origin.pem
deploy/hetzner/certs/origin-key.pem
```

Set the private key to mode `0600`. The `certs` directory ignores certificate
material so it cannot be committed accidentally.

## 3. Configure Core

Copy `.env.example` to `.env` and replace every placeholder. `.env` is ignored
by the repository. Keep it owned by the deploy user with mode `0600`. Runtime
secrets live only in this file.

Set `ARCHURA_ENV` explicitly. `staging` and `prod` require the database, edge
authentication, email delivery configuration, and HTTPS billing origin;
staging uses test-prefixed Archura credentials and Stripe test mode. The
current Hetzner deployment is staging, so its box `.env` uses
`ARCHURA_ENV=staging`.

Copy `release.env.example` to `release.env` for the initial manual deployment.
`release.env` contains only `CORE_IMAGE` and is managed by `release.sh` after
automation is enabled. Use an immutable commit tag or digest for `CORE_IMAGE`;
never use `latest`.

Before the live cutover, pin `POSTGRES_IMAGE` and `CADDY_IMAGE` to tested patch
versions or digests as well, then update them deliberately. Use URL-safe random
bytes for the PostgreSQL password and repeat the same value in
`POSTGRES_PASSWORD` and `DATABASE_URL`.

The image can be built with traceable version information:

```sh
docker build \
  --build-arg VERSION=v0.1.0 \
  --build-arg COMMIT=0123456789abcdef0123456789abcdef01234567 \
  --build-arg BUILD_TIME=2026-07-12T00:00:00Z \
  -t ghcr.io/your-org/archura-core:git-0123456789abcdef0123456789abcdef01234567 \
  core
```

Push the image to the registry before running the server deployment.
The repository workflow `.github/workflows/core-image.yml` runs the Go suite
against PostgreSQL and publishes `ghcr.io/<owner>/archura-core:git-<full-sha>`
on Core changes. For a manual release of a private package, authenticate the
server to GHCR with a read-only package token before running `release.sh`.

## 4. Deploy and verify

For a manual release, run:

```sh
cd /opt/archura/core/deploy/hetzner
./release.sh ghcr.io/your-org/archura-core:git-FULL_40_CHARACTER_COMMIT_SHA
```

Verify all boundaries:

```sh
# Through Cloudflare: liveness is public.
curl https://core.example.com/healthz

# Through Cloudflare: database readiness is deliberately hidden by Caddy.
curl -i https://core.example.com/readyz

# Without the Worker service credential, protected APIs reject the request.
curl -i https://core.example.com/v1/components

# These must fail from another machine.
curl http://SERVER_IP:8080/healthz
curl http://SERVER_IP:9091/metrics
nc -vz SERVER_IP 5432
```

Set the site Worker's `CORE_URL` to the proxied hostname and install the same
`CORE_SERVICE_KEY` with `wrangler secret put CORE_SERVICE_KEY`. The Worker must
continue stripping caller-provided service and client-IP headers before adding
its trusted values.

## 5. Configure automatic deployment

The workflow `.github/workflows/core-image.yml` tests pull requests. A
successful push to `master` builds an immutable GHCR image and deploys that exact
image to the current Hetzner staging box through the existing GitHub
`production` environment. The GitHub environment retains that name until a
separate production workflow is created. A manual workflow run publishes the
selected ref and deploys it only when the `deploy` input is enabled.

Create a GitHub Environment named `production` and add these environment
secrets:

```text
HETZNER_HOST
HETZNER_USER
HETZNER_SSH_PRIVATE_KEY
HETZNER_SSH_HOST_KEY
```

`HETZNER_SSH_HOST_KEY` must contain the verified OpenSSH `known_hosts` line for
the server. The workflow does not use `ssh-keyscan` because an unverified scan
would not authenticate the server. Install the matching public deploy key on
Hetzner.

The deploy user must own `/opt/archura`, have permission to use Docker, and be
restricted to the minimum server access needed for deployment. The workflow
copies only `core/deploy/hetzner` and invokes `release-from-ghcr.sh` with the
job's short-lived GitHub token. That script uses an ephemeral Docker credential
directory and removes it after the pull, so the job token is not retained on
the server. The workflow never copies `.env`, certificates, or editor source.

Protect the `production` environment with required reviewers if deployments
should wait for human approval.

## 5b. Platform owner and the ops console

`adminctl` is Core's server-side admin CLI (not part of the web server or the
customer dashboard). It runs pending migrations, records audit events, and needs
direct DB access via `DATABASE_URL`. It has three privileged operations:

- `bootstrap` — create/verify Archura's internal platform workspace and, if
  `PLATFORM_OWNER_EMAIL` is set, grant that account the `platform_owner` role.
- `grant-staff [email-or-account-id]` — grant an existing account the role
  (defaults to `PLATFORM_OWNER_EMAIL` when the argument is omitted).
- `revoke-staff [email-or-account-id]` — remove it.

**The account must already exist before it can be granted.** `deploy.sh` runs
`adminctl bootstrap` on every release (the `adminctl` job under the `jobs`
profile). It is idempotent and self-healing: on a fresh database the owner
account doesn't exist yet, so bootstrap warns and moves on; the grant lands
automatically on the next deploy after you sign up as `PLATFORM_OWNER_EMAIL`.

So to gain access to `/ops/` on a fresh install:

1. Set `PLATFORM_OWNER_EMAIL` and `ADMIN_API_ENABLED=true` in `.env` (the console
   returns 404 while `ADMIN_API_ENABLED` is false), then deploy.
2. Sign up as that email through the normal confirmation flow (needs email
   delivery, configured via the `CLOUDFLARE_EMAIL_*` vars).
3. Re-deploy — or run the grant directly:
   ```sh
   docker compose --env-file .env --env-file release.env \
     --profile jobs run --rm adminctl grant-staff
   ```

## 6. Enable maintenance

Docker's `restart: unless-stopped` policy restarts the long-running containers
after a server reboot. Systemd is optional and used here only to schedule Core
maintenance.

Copy the maintenance timer and service into `/etc/systemd/system/`, then enable
them:

```sh
systemctl enable --now docker
systemctl daemon-reload
systemctl enable --now archura-core-maintenance.timer
systemctl list-timers 'archura-core-*'
```

The paths in the units assume the repository is installed at `/opt/archura`.

## 7. Optional: configure off-server backups

Backups are not part of deployment and never block a release. When you are
ready to enable them, install `rclone` and `flock`, configure an `rclone` remote
for a private S3-compatible bucket, and set the optional backup values shown in
`.env.example`. The backup script creates a custom-format PostgreSQL dump,
writes a SHA-256 checksum, uploads both, and retains local copies for
`BACKUP_RETENTION_DAYS`.

The script fails when the off-server destination or `rclone` is unavailable;
it does not silently accept a same-machine-only backup.

Run and inspect the first backup manually:

```sh
./backup-postgres.sh
journalctl -u archura-core-backup.service
```

Only after the manual backup succeeds, install and enable the optional timer:

```sh
systemctl enable --now archura-core-backup.timer
```

Configure bucket-side retention or object locking separately. A daily dump is
the initial recovery strategy; add WAL archiving before the recovery point
objective requires less than one day of possible data loss.

## 8. Test restore

Download a dump and its checksum from off-server storage, verify it with
`sha256sum -c`, and restore only into a disposable environment first.

The restore script is destructive and therefore requires an explicit flag:

```sh
./restore-postgres.sh /path/to/archura-archura-TIMESTAMP.dump \
  --confirm-destroy-database
./deploy.sh
```

The script stops Core, replaces the configured database, restores the dump,
and starts Core. A production restore should remain a deliberate operator
action rather than a timer.

## Deploy rollback

Each release preserves the preceding image in `release.previous.env`. To
explicitly deploy it, run:

```sh
./rollback.sh
```

Database migrations must remain backward-compatible with the previous image.
If a migration is not backward-compatible, rolling back the image may also
require a compatible database restore. A failed health check does not
automatically reverse migrations or select the prior image.

## Stripe webhook path

When webhook event handling is implemented, Stripe should call a narrow public
Worker route. The Worker must stream the unchanged body and `Stripe-Signature`
header to a fixed Core path while adding `CORE_SERVICE_KEY`. Core must verify
the Stripe signature against the raw body and enforce event idempotency. Do not
exempt a public Core route from Worker service authentication.
