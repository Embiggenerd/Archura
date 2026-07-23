# Core plan: site-claim atomicity (rev 6)

Rev 1 (bind-first + compensating release) died in review: idempotent binds
make rollback ambiguous, the release endpoint is machine-only with
billing-recovery audit semantics, and anonymous drafts bypass core entirely.
Rev 2 (atomic R2 create-if-absent) survived review as the right primitive;
rev 3 fixes the two blocking gaps rev 2 left.

## Design recap

`sites/<name>/meta.json` is created with a conditional put
(`If-None-Match: *`; R2 returns `null` when the object exists, and R2 writes
are strongly consistent). That conditional create is the **single atomic
reservation** for the whole namespace — signed-in claims and anonymous
drafts contend on the same gate. Core remains the truth for confirmed
ownership; nothing about bind ordering changes.

## Fix 1 (review P1): meta must be the FIRST write in `/api/deploys`

The current anonymous flow writes draft artifacts and embed files *before*
meta, so two anonymous claimants can interleave draft writes even though
only one wins the conditional meta create. Reorder:

1. Conditionally create `meta.json` (it depends on nothing from the draft
   writes — site, siteId, componentPath, embed name/tag, status, createdAt
   are all known up front).
2. `null` → 409 immediately; **the loser performs no writes at all**.
3. Only the winner writes draft artifacts and embeds.
4. **One shared cleanup routine for EVERY post-reservation failure** — draft
   write failures *and* the confirmation-service failure that follows (and
   anything else added later): delete all draft/embed keys first, meta
   **last** (reuse `releaseSiteObjects` — it already implements exactly this
   ordering). This corrects a live bug the review found in the current code:
   the `/api/deploys` confirmation-failure path deletes `meta.json` FIRST
   and drafts after, so a partial cleanup frees the namespace while the old
   claimant's draft keys linger under it — a new claimant's promotion could
   then mix the previous claimant's content into their site. Meta-last means
   a partial cleanup leaves the name *reserved* (safe, sweep-collectable),
   never *free with residue*. If cleanup fails entirely, the
   drafted+unbound+aged sweep rules collect it — valid here because no core
   binding exists in the anonymous flow.

Same ordering discipline in `/api/sites` (signed-in): conditional meta
create → core bind → on core 409, delete own meta (safe: the conditional
create guarantees this request is the only writer).

## Fix 2 (review P1): reconciliation must never adopt a losing claim

The rev-2 "residual" was wrong. Failure path: a core binding exists for org
B with no meta (zombie); claimant A's conditional create then succeeds, core
bind 409s (B owns it), and A's meta cleanup fails. The sweep today sees meta
without `organizationId`, asks core, gets "bound to B" — and **backfills B's
org onto A's meta**, whose `tokenHash` is A's claim token. That would give
the losing claimant publish control of a site core attributes to B.
Cross-tenant escalation, not cleanup.

Changes:
- **Signed-in reservation meta records intent**: `/api/sites` writes
  `organizationId` (the org it is about to bind) into the meta at creation,
  not after. A reservation is then never ambiguous about whom it was for.
- **Sweep rules become a mismatch matrix** (replacing blind backfill):
  - meta has `organizationId`, core binding agrees → healthy (also covers
    the old crash-between-meta-and-bind stranding, which now self-identifies).
  - meta has `organizationId`, binding is **absent** → unconfirmed
    reservation: apply the existing aged+unpublished abandonment rules.
  - meta has `organizationId`, binding names a **different org** → release
    the meta (ordered, meta last). Never adopt, never backfill over a
    recorded intent.
  - meta lacks `organizationId` and is `status: "drafted"` (a modern
    anonymous claim) → **never backfill.** The losing-confirmation sequence
    (core binding already owned by B, anonymous A reserved the name, A's
    email confirmation 409s) leaves exactly this shape, and backfilling
    would associate A's draft content and site identity with B — the same
    adoption bug as the signed-in case, minus the token. A successful
    confirmation crashed before its meta update is indistinguishable from
    that conflict, so the safe rule is uniform: drafted + bound-in-core →
    release the meta (ordered, meta last) once older than the confirmation
    TTL grace; drafted + unbound → existing abandonment rules. Worst case a
    crashed-confirm user loses an unpublished draft and reclaims — their
    core binding survives, and the same-org rebind heals the pair.
  - **transitional shape** — meta lacks `organizationId` and `status` but
    HAS `createdAt`: ambiguity is resolved by **provenance, not published
    content**. Published residue can survive under a prefix whose meta was
    deleted (the free-namespace-with-residue bug this very plan documents),
    so artifacts prove only that *something* once lived there — never that
    the current meta's claim token belongs to core's owner.
    **Has `tokenHash`** → it is a pre-rev4 signed-in reservation or race
    loser: never backfill, regardless of published residue; release after
    the grace period (the residue is orphaned junk of an earlier partial
    cleanup, and the owning org's binding heals by same-org reclaim).
    **No `tokenHash`, published content present, recognizable legacy
    shape** → preserve under the legacy-content guard; backfill-if-bound
    allowed for this shape only.
  - meta lacks `organizationId` AND has no `status`/`createdAt` (the true
    legacy shape, positively identified) → today's backfill-if-bound
    remains, plus the existing legacy-preservation guards unchanged. Blind
    backfill is now confined to shapes that predate intent recording or are
    positively published.

## Tests (review P2 — integrity, not just the winner's meta)

Worker suite (MemoryBucket gains create-if-absent semantics):
- concurrent same-name claims — same flow and cross-flow (anon vs signed-in):
  one winner; loser 409s having written **zero keys**; winner's meta *and*
  draft artifacts/embeds byte-match the winner's request.
- loser never runs meta cleanup after a `null` conditional create.
- core-conflict + failed meta delete → sweep releases the mismatched meta
  and does **not** backfill the owning org onto it.
- drafted anonymous meta whose name is bound in core → sweep releases after
  the grace, never backfills; true-legacy shape (no status/createdAt) still
  backfills — both directions pinned.
- transitional shape (createdAt, no organizationId, no status): a
  **token-bearing meta sitting over published residue** with core bound to
  another org → never backfilled, released after grace (the cross-tenant
  adoption regression test); tokenless published legacy shape → preserved
  and backfilled when bound — both directions pinned.
- confirmation-service failure → shared cleanup runs, all keys gone, meta
  deleted last; with a fail hook forcing partial cleanup, meta **remains**
  (name stays reserved — no free-namespace-with-residue state) and the
  sweep collects it later.
- post-reservation draft-write failure → same shared routine, same
  assertions.

Gate before any of this lands: one empirical two-put check against **real**
R2 (miniflare's conditional emulation is not proof). If real R2 refuses
wildcard `If-None-Match`, fall back to rev 1's bind-first, which then needs
the full earlier program (created-flag bind, purpose-specific internal-key
rollback, anonymous-flow answer).

## Core work

None functional. Unchanged small items: fix the OpenAPI `InternalAuth`
omission on the release endpoint; optional concurrent-bind PK test.
