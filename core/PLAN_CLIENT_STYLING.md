# Core Plan — Per-Client Styling: Namespace Binding Only

**Styling itself needs no core work.** Styling is presentation data and lives at the
edge: publish regenerates a per-client embed module in R2
(`sites/<slug>/embed/<component>.js`), so embeds update on next load with no core
round-trip. The full design and all styling work items are editor/Worker side — see
`docs/PLAN_CLIENT_STYLING.md`, and the "Namespaces & the tenant →
namespace binding" section of `docs/AUTH_ARCHITECTURE.md` for the model.

What core *does* own is identity: core is the single authority for who a client is and
which content namespace they own. That adds **one small work item** so registration can
tie a core tenant to its edge namespace (`sites/<slug>/`).

## Work item — store the tenant → namespace binding

`tenants.slug` already names the namespace. Add storage for the namespace's edge
credential (the claim token), so core knows every binding and can later release
credentials to dashboard sessions (client → their own namespace; platform admin → all
namespaces).

1. **Migration `0005_namespace_binding`** (latest existing migration is
   `0004_rate_limits`):

   ```sql
   ALTER TABLE tenants ADD COLUMN edge_claim_token TEXT;
   ```

   Nullable — tenants registered before/without an edge namespace simply lack it.
   Prototype: stored plaintext so it is releasable later; encrypt before real
   merchants (tracked as a known hardening step, do not build encryption now).

2. **Accept it at registration.** `POST /v1/clients` (`createClientRequest`) gains an
   optional `edge_claim_token` string (bounded length, e.g. ≤ 128 chars). Stored on the
   tenant. **Never echoed back** in the create response or any future read — it is a
   credential, not metadata. Include a `namespace_bound` boolean in the existing audit
   metadata instead of the value.

3. **Nothing reads it yet.** No release endpoint until the dashboard sprint — do not
   add one speculatively.

*Verify:* `go test ./...` — create client with `edge_claim_token` → persisted; response
body does not contain it; create client without it → NULL; migration applies from a
database at `0004`.

## Explicitly out of scope

- Anything styling-related (edge-owned).
- Accounts, passwords, dashboard sessions, credential-release endpoints — auth stays
  claim token + admin key for now; passwords come later **if** we go that route, and
  then only hashed, only in core.
- Encryption of the stored claim token (noted hardening step).
