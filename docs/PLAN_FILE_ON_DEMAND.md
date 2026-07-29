# Plan — File-on-Demand: R2 as the Only Content Store, Files When Devs Need Them

Branch: `file-on-demand` (off master). Supersedes the file-first CMS design
(parked on `draft-on-file`; `docs/CMS_*.md` describe that design and do not
apply to this branch). Revised after review — hook points, concurrency
protocol, and the Core deployment requirement corrected.

## The decision

Customer content — drafts and published — lives in **R2
(`archura-artifacts`)**, written directly by the site Worker, exactly as
master works today. There is no CMS service, no file tree on the Hetzner
box, and no git involvement in customer content. The box's Postgres keeps
what it already has: accounts, orgs, billing, fork rows, audit.

Files exist for **devs and agents, on demand**: a pull tool materializes any
customer component into the local checkout, where the existing Vite
`artifact-store` middleware serves it to the local editor. Changes go back
through the product — fork-apply or a proposal design — never by pushing
files.

Two gaps in master get closed, because R2 has no native object versioning:

- **History**: every publish also writes a timestamped copy under
  `history/`; a bucket lifecycle rule expires it after 90 days.
- **Fork-apply**: the audited return door for dev/agent fixes.

Deliberately out of scope: draft versioning (editor undo/stash covers the
session), backups beyond the 90-day history window, any second serving path
for R2 outages, any push verb on the pull tool, staging/agent-credential
machinery.

## Step 1 — History writes on publish

Worker-only. Add a helper:

```js
// history/<key>/<ISO timestamp>-<uuid> — same bytes, same content type.
// UUID suffix: two publishes in the same millisecond must not collide.
async function recordHistory(env, key, bytes, contentType) { ... }
```

Ordering: **history first, live write second** — abort the live overwrite
if the history put fails. This guarantees every successful publish has a
history record; the failure mode is a publish error the client retries,
never a versionless publish.

Hook points — every servable-content write, and only those:

- **Site artifact publish (`site-worker.js:1349`)** — the main path for
  ordinary edits to established sites (tier-gated PUT of
  `sites/<site>/<artifactPath>.json`).
- Design publish: `artifact.json` (`site-worker.js:1277`) and the embed
  loop (`:1281`).
- Design-scoped single-embed publish (`:1301`) and site embed publish,
  `PUT /api/embeds` (`:1394`) — both write served keys with no draft stage.
- **Inside `promoteSite()`'s draft→live copy loop (`:1940`)** — this one
  spot covers both staged-funnel promotion and the armed lazy-publish
  (their call sites at `:1554` and `:1994` write only `meta.json`, which
  the exclusion rule skips). The loop currently streams `source.body`;
  buffer via `arrayBuffer()` so the same bytes can be written twice.

Excluded: `meta.json` writes (bookkeeping, not content versions), draft
keys, assets (immutable-named at upload), and the fork-create copy
(`:699`) — a brand-new key's first version, nothing to roll back to.

Retention: one-time lifecycle rule —
`wrangler r2 bucket lifecycle add archura-artifacts history-90d history/ --expire-days 90`
(command shape confirmed against the installed wrangler).

Erasure invariant — **history is purged first, live keys after**:

- Sites: inside `releaseSiteObjects()` (`:1732`), purge
  `history/sites/<site>/` **before** the existing ordered purge runs.
  That function deletes `meta.json` strictly last because reconciliation
  discovers partial purges through meta — history must be gone before that
  marker is, or a crash strands history keys nothing will ever find.
- Designs: in the org purge / nightly reconciliation `purgePrefix` callers
  (around `:1859`), purge `history/orgs/<org>/` **before**
  `orgs/<org>/`, same reasoning.

Verify:
- Local `wrangler dev`: publish a design → mock R2 shows
  `history/orgs/.../artifact.json/<ts>`; promote a staged funnel site →
  history keys for the copied set.
- Injected purge failure (fault in the R2 delete): site remains
  discoverable via meta, re-run completes, no orphaned history.
- Staging: publish, `wrangler r2 object get` the history key; lifecycle
  rule listed on the bucket.

## Step 2 — Pull tool

`archura-editor/scripts/pull-artifact.mjs` (S3 API against R2 via
`aws4fetch` — add it to `archura-editor` devDependencies; today it exists
only in the parked `cms/` package).

- Auth env: `R2_PULL_ACCOUNT_ID` (forms the endpoint
  `https://<account>.r2.cloudflarestorage.com`), `R2_PULL_ACCESS_KEY_ID`,
  `R2_PULL_SECRET` — a **read-only** token scoped to `archura-artifacts`.
  Read-only + bucket-scoped is the whole blast radius.
- **Site pulls need no remapping**: the local adapter's disk layout mirrors
  R2 verbatim for sites (`adapters/index.ts:78-85` —
  `artifacts/sites/<site>/...` ⇔ `sites/<site>/...`), so
  `pull-artifact sites/<site>` is ListObjectsV2 + GetObject + write-through.
- **Design pulls require `--as <local-site-alias>`** and a transformation —
  there is no `/api/orgs` middleware in `vite.config.ts`, so `orgs/...`
  keys are unreachable locally. The tool rewrites
  `orgs/<org>/designs/<id>/artifact.json` →
  `artifacts/sites/<alias>/<componentPath>.json`, with `componentPath`
  read from the artifact body (the layout the dev adapter expects), and
  `embed/<Name>.js` → `artifacts/sites/<alias>/embed/<Name>.js`.
- **Dev-editor wiring for aliases** — one small `edit/index.html` change:
  today the local branch always calls `createFileSystemAdapter()` (site
  hardcoded to `dev`, `edit/index.html:404`), and `?site=` selects the
  *remote* R2 adapter (`:343`) — so pulled aliases would be unreachable.
  Add a dev-only `?localSite=<alias>` parameter that mounts
  `createFileSystemAdapter({ site: alias })`. The pull tool prints the
  exact editor URL (`/edit/?localSite=<alias>&component=<path>`) on
  completion.
- **Stale-target cleanup**: replace the entire target alias/site directory
  under `artifacts/`, not individual keys — a leftover `*.draft.json`
  would shadow the pulled published artifact, and removed embeds would
  linger.
- Snapshot age: designs have no `meta.json` in R2, so print each pulled
  key's S3 `LastModified` and `ETag` instead.
- Flags: `--drafts` (default skips `*.draft.json` and `*/draft/*`).

Verify: pull a staging site and a staging design (`--as`); both render in
the local editor via the printed URL; a planted stale local draft is
removed; `git status` clean.

## Step 3 — Fork-apply (the return door)

`POST /api/ops/forks/:id/apply` in `site-worker.js`, staff-gated like
fork-create (Core 403s non-staff before the Worker touches R2).

**This step requires a Core change and a Core (Hetzner) deployment** — the
one exception to "Cloudflare only":

- Migration: `designs_fork_status_check` currently allows only
  `pending/ready/failed` (`0012_admin_console.up.sql:77`) — `ALTER` to
  drop/re-add the constraint with `applied`.
- Store/API/OpenAPI: finalize currently accepts only `ready/failed`; add
  the `applied` transition, **idempotent** (`applied` → `applied` is a
  no-op success, so Worker retries can re-finalize safely). Actor and
  which warnings were forced live in **audit metadata only** — no new row
  fields: allowlist `admin.fork_applied` **and**
  `admin.fork_apply_rejected` with `ForkAuditMetadata` at
  `core/internal/store/audit.go:51`, extending that metadata with
  `forced_warnings []string`.

Worker protocol — anchored on two reads: the source `artifact.json`
(etag `E_now`; may be absent for template forks) and the fork's published
`artifact.json` (etag `E_fork` — its own HEAD/GET, needed for the resume
check):

1. Preconditions: fork row `fork_status` is **`ready` or `applied`** —
   `applied` is a legitimate resume state (Core committed but its response
   was lost); rejecting it would strand the retry before Core's idempotent
   finalize can answer. Fork must have a published `artifact.json`.
2. **Resume detection**: `E_now` equals `E_fork` (same bytes → same etag
   for simple puts) means a previous attempt already landed the artifact.
   On resume, skip the staleness warning (the "change" is our own write)
   and the source overwrite — but **not** the open-draft check or
   finalize.
3. Warnings (409 with names; `{ "force": true }` proceeds):
   - *Open draft*: source `artifact.draft.json` exists. **Checked on every
     attempt, including resume** — a draft the client opened after a first
     partial attempt must still surface.
   - *Staleness* (skipped on resume): normalized `E_now` ≠ fork-time
     `source_artifact_etag` (fork-finalize stored the unquoted form; R2
     returns quoted and unquoted variants — normalize both sides).
     Template forks (`source_artifact_kind: 'template'`) have a null
     fork-time etag: if the source now *has* an `artifact.json`, that
     counts as stale.
4. Archive: copy the source's current published set (`artifact.json` +
   `embed/*.js`) to `history/<key>/pre-apply-<forkId>` with
   `onlyIf: If-None-Match: '*'` — true create-once under concurrency, the
   same pattern `reserveSiteMeta` already uses (`:1717`); a head-check is
   not. Template forks with no source artifact archive nothing, gracefully.
5. Gates: run `deployCheck` against the source org; run moderation on the
   fork's artifact — a moderation flag **blocks apply (409) and emits
   `admin.fork_apply_rejected`** (a blocked apply never emits
   `admin.fork_applied`, so the rejection needs its own event to be
   auditable). No design-level meta/flag machinery in v1 (that plumbing is
   site-specific today, `:489`).
6. Write (skipped on resume), two branches by source state:
   - *Source exists*: overwrite `artifact.json` with
     `onlyIf: If-Match: <quoted E_now>` — closes the check-then-write race
     with a concurrent client publish *and* serializes two staff applying
     different forks to one source (the loser gets a fresh 409).
   - *Source absent (template fork)*: create with
     `onlyIf: If-None-Match: '*'` — a concurrently created first artifact
     wins and the apply 409s.
   Then copy the fork's embeds (normal publish semantics — writes what it
   has, never deletes stale source embeds). Every overwrite goes through
   step 1's `recordHistory`, history-first.
7. Finalize: Core marks the row `applied` (idempotent), emits
   `admin.fork_applied` with actor + forced warnings from the request.
   Trimmed by decision: no durable apply manifest — if the Worker crashes
   between the write and finalize, the retry's audit event reports forced
   warnings as unknown. Accepted: audit cosmetics on a staff-initiated,
   archived, recoverable operation.

One sequencing note: R2's honoring of `If-None-Match: '*'` is verified in
the repo (2026-07-23 note at `reserveSiteMeta`), but **`If-Match` on put is
attested nowhere yet** — run the concurrent-apply staging drill *early* in
this step, before building on the conditional, not as final verification.

Verify (staging drill + deterministic tests): fork → source publishes →
apply 409s staleness → force succeeds → source serves the fork's set,
`pre-apply` archives exist, row `applied`, audit event carries
`forced_warnings`. Retry after injected partial
failure resumes via etag equality instead of 409ing — including the
lost-finalize-response case (row already `applied`) and a draft opened
between attempts still warning. Two concurrent applies: exactly one wins,
the other 409s (this drill runs *early* — it attests `If-Match`).
Template-fork apply with and without a source artifact. Moderation-blocked
apply emits `admin.fork_apply_rejected`.

## Step 4 — Editor autosave stash/retry

Port from the parked branch
(`git show draft-on-file:archura-editor/src/editor/ArchuraEditorController.ts`) —
the revision-guarded save, localStorage stash, and restore-on-load are
cleanly separable (all inside `#config.persistence` usage). Two fixes while
porting:

- **Scope the stash key.** The parked version keys by component path only
  (`archura.pending.pages/Landing`) — the same path recurs across
  customers, so a stale stash from one site could be offered for restore in
  another's design. Key by a host-provided scope:
  `archura.pending.<site:X | design:org:id>.<componentPath>`.
- Clear retry timers on controller destruction.

Verify: with the dev worker stopped, edit → autosave fails → stash persists
across reload → restarting drains the retry; a stash written under site A
is not offered in site B's editor with the same component path.

## Order, effort, deploy

1. Step 1 + Step 2 (about a day together) — history accumulates
   immediately; the pull workflow becomes testable against staging.
2. Step 3 (three–four days including the Core migration, API change, and
   tests) — the only step touching Core.
3. Step 4 (half a day).

Deploy: `wrangler deploy` of the site worker, the one-time lifecycle rule,
a read-only R2 API token for devs — plus **one Core release for step 3**
(migration + finalize/audit change). Steps 1, 2, and 4 need nothing on the
Hetzner box.
