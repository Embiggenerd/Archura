# Plan — Free-tier component gating + environment signal (core)

Two additions the editor changes depend on. A different model executes this.

**Context.** The client now enforces the tier rule on the front page (free /
anonymous visitors build **full pages** only; the Stripe / "Payment component"
option prompts sign-up, and backend components are removed from the free palette).
Client gating is **bypassable**, so core must enforce the rule server-side. And
the `/ops/` badge currently *guesses* dev/prod from the hostname — core should
expose the real environment.

---

## Part 1 — Free-tier component rule (server enforcement)

**Rule.** A **free** org (entitlement not `active`/`trialing` paid, and not
`caps_exempt`) may only deploy/publish **page-kind** components. **Paid-required**
components — Stripe / backend (`payments/*`) and other standalone (non-page)
components — require an active or trialing Basic subscription. Free orgs deploying
a *page* is fine even though pages are built from smaller components; the gate is
on the **deployed unit** (plus nested backend components, below).

### 1a. Authoritative tier map (single source of truth)
A small, testable function in core:
```
componentTier(componentPath) -> "free" | "paid"
  pages/*        -> free      (page-kind)
  payments/*     -> paid      (Stripe / backend)
  <everything else / standalone component-kind> -> paid
```
Keep it a plain function so the set is easy to tune. (Product decision: pages are
free; standalone components are paid/dev-facing.)

### 1b. Enforcement points
- **Design create / publish** — `CreateDesign` (and any design publish) already
  knows `component_path`. If the org is free and `componentTier(component_path) ==
  "paid"` → reject.
- **Site publish (Worker-owned R2 path)** — the Worker already gates publish on
  the org entitlement (`requireSiteEditEntitlement` → core). Make that check
  **component-aware** so the Worker can block a free org publishing a paid
  component. Cleanest: add
  `POST /v1/organizations/{id}/deploy-check { component_path }` →
  `{ allowed: bool, code?: "component_requires_paid" }`, which the Worker calls
  with the artifact's top-level `componentPath`. (The Worker has it from the
  artifact/site meta.)
- **Nested backend components** — a free *page* could still embed a `payments/*`
  instance. The published artifact lists instances in `content.components` (each
  with its `componentPath`); the same publish check should scan them and reject if
  the org is free and any instance is paid-tier. Core already parses the artifact
  for moderation on publish, so this rides alongside that.

### 1c. Error contract
`402 component_requires_paid`, body `{ "error": { "code":
"component_requires_paid", "message": "Publishing this component needs the Basic
plan." } }`. The client maps this code to the existing upgrade modal (paid) or the
register funnel (anonymous).

### 1d. Precedence
`active`/`trialing` paid or `caps_exempt`/workspace → allowed for all components;
free → page-kind only (top-level and nested).

### Tests
- free org + `payments/*` (standalone) → 402 `component_requires_paid`.
- free org + `pages/*` → allowed; free org + `pages/*` containing a `payments/*`
  instance → 402.
- active/trialing Basic + `payments/*` → allowed; workspace/`caps_exempt` → allowed.

## Part 2 — Environment signal (ops badge)

The `/ops/` badge should reflect `ARCHURA_ENV` (dev / staging / prod), not a
hostname guess (which can't tell staging from prod).

- Expose `env` on the admin surface — simplest: `GET /v1/admin/context` →
  `{ "env": <ARCHURA_ENV> }` (or include `"env"` on the admin org-list response).
  The Worker forwards it under `/api/ops/*`; the ops page reads it and labels the
  badge Dev / Staging / Production, replacing the hostname heuristic.
- Keep it staff-gated like the rest of `/v1/admin/*`.

### Tests
- the field reflects `ARCHURA_ENV`.

## Sequencing
Part 1 is the real work — the server backstop for the client tier gating; do the
design-create + `deploy-check` paths first, then the nested-component scan. Part 2
is a small additive endpoint. Both are additive and independent.
