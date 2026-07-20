# Tenant Dashboard — Thin Console (later sprint)

**Status: planned, deferred to a later sprint.** A thin tenant console over the core APIs
that already exist — not a second product. ~4–5 screens, no teams/SSO/billing polish yet.

## Who it's for

Merchant staff (and you, early on). Engineers still mint component sessions from their own
backend; the dashboard never becomes the thing that holds `sk_` in a browser. It manages
keys, component config, Connect, and links out to the editor.

## Mental model

```
Platform admin (you)   →  create tenant + first keys (POST /v1/clients)
Client dashboard       →  keys, component CRUD, Connect, "Open editor"
Editor                 →  content / style knobs only
Merchant backend       →  mint component sessions (holds sk_)
Embed on merchant site →  checkout with the ct_ token
```

## The load-bearing decision: the dashboard never touches `sk_`

The core stores only the **hash** of the tenant secret (`TenantBySecretHash(Hash(token))`);
after "shown once," the secret is unrecoverable — the platform genuinely cannot reproduce
it. Consequences:

- **`sk_` is exclusively the merchant-backend credential** — copy once, never used by the
  dashboard.
- The dashboard's component CRUD and key rotation are authorized by an **admin session**
  (account → tenant), which means the **core needs an admin-session auth path** alongside
  the existing `sk_` path. Rotation = mint new secret, show once, store hash — via admin
  auth, never consuming the secret.
- This is *simpler* than a BFF holding every tenant's secret (which is impossible anyway).

**Lab stopgap (phase 0, single-tenant, = you):** password-gate a single-tenant page whose
tiny BFF holds *your own* `sk_` in its env (you saved it when you created the tenant). Valid
for one tenant; does not generalize to real merchants (you won't retain their secrets), so
it is explicitly the start, not the architecture. The durable version is admin-session auth.

**Transport:** route the dashboard through the edge Worker as its BFF, using the service key
(`X-Archura-Service-Authorization`) for transport trust + the admin session for authz; the
core re-authorizes (per `FINTECH_ARCHITECTURE.md`).

## Screens

### 1. Login
Email magic link (or a single shared staff login at first). Session = "admin of tenant X" —
a dashboard session, **not** a component token.

### 2. Overview
One page: tenant name/slug, Connect status (not connected / test / live), component count,
"Open editor" deep link. That's it.

### 3. API keys
- Publishable key: shown always.
- Secret: shown once at create/rotate; afterward `••••` + **Rotate**.
- Copy-paste block: "mint a session from your backend with `POST /v1/component-sessions`"
  (documents the merchant-backend flow; the dashboard does not mint for real traffic).
- No key analytics; no envs beyond test/live later.

### 4. Components
Table from the API: id, mode, status, allowed origins, success/cancel URLs.
- Actions: **Create / Edit** (form → `POST`/`PUT /v1/components`).
- **Config vs style ownership (explicit):** the form owns *server config* (price, mode,
  allowed origins, success/cancel URLs); the *editor* owns *styling*. "Configure in editor"
  means styling only — one source of truth per layer.
- **Copy embed snippet:** `<archura-stripe-payment …>` + `api=` + publishable key, using the
  **immutable `/v1/…` component URL** so a pasted embed never changes under the merchant.

### 5. Stripe (when Connect lands)
One button: **Connect with Stripe** → hosted onboarding. Status badge + "Payments are
processed on your Stripe account; Archura takes an application fee." No custom KYC UI.

### 6. Recent activity (optional, deferred)
Read-only list: last N checkouts/sessions (id, status, amount, time). No charts. Skip until
webhooks exist.

## What "thin" explicitly skips

- Self-serve signup / org creation (you still `POST /v1/clients`).
- Team invites, roles, SSO.
- Full billing portal, invoices, usage graphs.
- End-user management (that's the merchant's app).
- Rebuilding the GrapesJS editor inside the console.
- Marketing-site chrome.

## Concrete first version

One small SPA (Vite + whatever) with screens 1–4, talking to the core via the Worker proxy
with a tenant-admin session. Until admin-login exists, even thinner: the single-tenant lab
page above. Durable target: keys + component CRUD + Connect + "Open editor," on admin-session
auth.

## The fork to decide when this sprint starts

- **Admin-session auth in the core now** — makes the dashboard durable and multi-tenant;
  touches `./core` (new auth path).
- **Lab stopgap first** — single-tenant, your `sk_` in a BFF; stays in `archura-editor/`, defers
  the core work.

Everything else waits until Connect and real merchants force it.
