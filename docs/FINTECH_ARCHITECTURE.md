# Fintech Architecture — Trust Boundaries & the Edge/Core Split

Target architecture for when Archura handles regulated financial data (payments, then
credit). It is a **staged decision, not current state**: today the Cloudflare Worker is the
entire backend (stateless request/response over R2), which is correct for the pre-regulated
workload. This doc defines what changes when regulated data and money logic enter, and —
most importantly — **where the security boundary sits.**

Companion to `STRIPE_COMPONENT.md` (which describes the pre-regulated Stripe demo, where
credentials live in the Worker); this doc supersedes that credential placement for the
regulated build (see §Secrets).

## The one rule everything else follows

**The security boundary is the Go core. The edge (Worker) is optimization and a first
filter — never the place a sensitive decision is finally made.** Every rule below is a
consequence of this.

## The split

```
Client
  ↓  (TLS)
Cloudflare Worker  — edge gateway / backend-for-frontend
  ├── routing
  ├── rate limiting & bot/DDoS protection
  ├── coarse token verification (valid/unexpired session?)
  ├── request validation & sanitization
  ├── caching  — PRESENTATION ONLY, never regulated data
  └── response shaping / NON-SENSITIVE aggregation
        ↓  (mutually-authenticated internal API: mTLS or signed service tokens)
Go core  — regulated system-of-record (the security boundary)
  ├── identities & sessions (authoritative)
  ├── authorization / permissions (final decision)
  ├── financial accounts, balances, append-only ledger (ACID / Postgres)
  ├── payment state (idempotency, webhook reconciliation)
  ├── credit/payment provider integrations + consent + audit
  ├── secrets / vault (Stripe keys, provider creds, DB creds)
  └── primary relational database
```

## Why fintech forces the core onto a real server

- **Ledger integrity** — money needs ACID transactions, strong consistency, append-only
  auditability: Postgres, not eventually-consistent edge stores. This alone justifies it.
- **Data control & residency** — SOC 2 / GLBA / FCRA / PCI are far easier to reason about
  when regulated data lives in one known region with your encryption and audit, not smeared
  across an edge platform's KV/R2/D1.
- **Blast radius** — one hardened service with a narrow API is a smaller attack surface than
  many edge functions each touching sensitive data.

This is the concrete answer to "can Workers do everything forever?" — no; the regulated
core is exactly where a dedicated server earns its keep.

## Design rules (each a consequence of the boundary rule)

1. **Authorization is enforced at the core, not the edge.** The edge may do coarse token
   validation as a first filter, but the source of truth for permissions and the *final*
   authorization decision live in the Go core, next to the data. Never let "the edge
   checked it" be the security boundary — the core re-validates identity and authorizes
   every sensitive operation. (Treating the gateway as the auth boundary is a classic
   fintech breach pattern.)

2. **The edge caches presentation, never regulated data.** Component modules, marketing
   pages, public UI: cacheable. Balances, PII, payment state, credit data: `no-store`.
   This extends our existing rule ("credit data never enters artifacts/R2") to the edge:
   **regulated data never enters the edge's cache or logs.**

3. **The Worker is inside the data-in-transit boundary even though it stores nothing.** It
   terminates TLS and, if it aggregates, sees regulated data flowing to the client. So:
   its logging must never capture sensitive bodies; the Worker↔core link must be mutually
   authenticated and encrypted (mTLS or signed service tokens — not "internal network");
   and Cloudflare is a **subprocessor** covered by a DPA and included in the SOC 2 vendor
   assessment. Storing nothing ≠ out of scope.

4. **Sensitive aggregation happens in the core.** UI response aggregation at the edge is
   fine for public/non-sensitive data. Any view that assembles regulated data (balances +
   payments + credit summary) is assembled inside the core (a thin BFF layer there), so
   regulated-data assembly stays within the auditable boundary. Small latency cost, large
   compliance simplification.

5. **Secrets and the money/credit integrations live in the core.** Stripe keys,
   credit-provider credentials, DB creds → the core's secret management / vault. The credit
   pull *runs in the core* (it touches regulated data, consent, audit); the Worker only
   routes, and the core returns the minimum necessary to the UI. The Worker holds only its
   own limited secret (the service token to call the core). This supersedes the
   Stripe-demo's "credentials in the Worker" for the regulated build — same principle
   ("secrets never client-side"), stronger placement.

6. **Payment state needs idempotency, webhook reconciliation, and a real ledger.** In the
   core: idempotency keys on money operations; Stripe webhooks as the authoritative source
   of payment truth (never trust the client's success redirect); an append-only,
   double-entry ledger; reconciliation jobs. The Worker may *receive* the webhook at the
   edge, but authoritative processing and signature verification happen in the core.

## Compliance map (design for it, don't retrofit)

- **SOC 2** — table stakes for B2B fintech; the split keeps the audited surface small.
- **PCI DSS** — stay at the light **SAQ A** by keeping card data in Stripe-hosted flows;
  it never touches the Worker or the core.
- **GLBA safeguards** — for financial data held in the core.
- **FCRA** — for credit: permissible purpose, consent capture, adverse-action support, via
  a **sponsor provider** (Array / CRS / Stitch Credit) — do not become a CRA.
- **Money transmission** — avoid licensing by using Stripe/Connect so Archura never holds
  or moves funds itself.
- **Privacy** — CCPA/GDPR; DPAs with all subprocessors, including Cloudflare.
- **Audit logging from day one** — who accessed which regulated data, when, and under what
  purpose. Retrofitting audit trails is miserable and regulators ask.

## What this preserves

- **The mistakeless envelope.** Clients (and agents) still only turn knobs on constrained
  components; sensitive logic is vetted Go code; components *display* regulated data but
  never handle money or credentials. The Go core is where "the platform owns correctness"
  becomes literal for the regulated parts.
- **The lock-in hedge.** The Go core is portable to any cloud; the edge is a swappable
  optimization. Keep the components/editor talking to a **data-plane interface** (the same
  discipline as `ArchuraPersistenceAdapter`), so the edge fronting — or an eventual
  migration — is a swapped implementation, not a rewrite.

## Staging (when to build which part)

1. **Now / pre-regulated:** Worker-only, R2 JSON. Correct for artifacts, assets, serving,
   and the Stripe *demo* (Level 0/1 per `STRIPE_COMPONENT.md`).
2. **First regulated money (Stripe Connect, real merchants):** introduce the Go core for
   payment state, secrets, ledger, and idempotency/webhook reconciliation. Worker becomes
   the gateway in front of it.
3. **Accounts & permissions:** identities, sessions, authorization in the core + Postgres.
4. **Credit / fintech data plane:** provider integration, consent, audit — all in the core;
   the data-connected component fetches through Worker→core; regulated data never lands in
   the edge layer.

The trigger to stand up the core is **the first time regulated data or money logic exists**
— not before. Until then, Worker-only remains the right, ops-free default.
