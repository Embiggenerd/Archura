# Full-Stack Components — Patterns (design notes, revisit later)

**Status: exploratory. Not a plan.** Captures the architecture options for
components that ship a frontend piece *and* a dedicated backend piece, so a
whole capability (e.g. a CRM client↔end-user communication module reusable
across bookkeeping / HVAC / any real-world service) can be dropped into anyone's
design. Revisit when we actually build the second data-connected component.

## The framing

This is the "full-stack component" / "vertical feature module" problem. The key
insight: **our platform already commits to an answer.** A CRM comms module is
the *second instance* of a "data-connected component" — the shape
`STRIPE_COMPONENT.md` and `AUTH_ARCHITECTURE.md` were rehearsing. The payments
component was the first; comms is the same shape on messaging data (no FCRA
exposure), one level up from cosmetic components.

So the real question is not "which exotic pattern" but "how do we keep the
growing backend clean as components 2, 3, N arrive."

## The core fork: whose backend runs the component's logic?

Everything forks here. Three industry answers:

1. **Vendor-hosted backend (embedded SaaS).** The frontend talks to *our*
   multi-tenant backend; the host provides only identity (a publishable key)
   and, for user-scoped data, a short-lived scoped token. Stripe, Plaid,
   Intercom, Algolia — and the closest analogues to CRM comms: **Stream
   (getstream.io), Sendbird, Liveblocks, Novu.** *This is what we already
   built*: edge component + Go core as authorization/data server + `pk` per org
   + the `sk → ct_` token exchange. Our comms module is this, on messaging data.
2. **Host-hosted backend (marketplace / app model).** Vendor ships a frontend
   slot + a contract (webhooks, OAuth scopes, events); the host runs the
   backend. Shopify apps, Slack apps, Salesforce AppExchange. Wrong for us —
   contradicts "no client backend."
3. **Vendor runs both in a sandbox (purest drop-in full-stack component).**
   Atlassian **Forge**: write a frontend function + a backend function, they
   execute both with managed storage/auth. Most literal answer to "a frontend
   component and a specific backend just for it," and the aspirational end
   state — but heavy infrastructure.

**Decision: we are firmly #1 and should stay there.** It's the only option
consistent with "no client backend" and edge-first (presentation at the edge,
data/auth in core).

## The sub-decisions (given #1)

- **Structure of the growing core — modular monolith of bounded contexts.**
  Each component-backend owns its own package, table namespace (`comms_*`),
  route prefix (`/v1/comms/...`), and migrations, while *sharing* the identity,
  org/membership, audit, billing, and token-exchange spine. One deploy,
  hard-enforced module boundaries. **Resist microservices-per-component** at
  this stage; peel out only the one component that genuinely needs separate
  scaling or a separate team (likely the regulated credit plane), not all.
- **Frontend↔backend contract — a manifest per component.** Generalize today's
  trait/`styleParts` introspection: a data-connected component *also*
  self-describes its backend capability — frontend tag, backend route prefix,
  required scopes, data namespace, emitted/consumed events. The registry wires
  both ends. This manifest is the seam that makes "drop it in" mean something
  (how Shopify/Forge/Medusa all do it).
- **Frontend authorization — scoped ephemeral tokens.** Straight from
  `AUTH_ARCHITECTURE.md`: the embed carries the org `pk` (identity) plus, for
  user-specific data, a short-lived token asserting `(org, end-user, scope,
  consent)`. For comms the scope is "read/write messages for org X between
  client and end-user Y." Backend authorizes by token claims; no long-lived
  secret in the browser. Same Stripe-ephemeral-keys / Plaid-link-token pattern
  already spec'd — comms is a new scope.
- **Data isolation — org-scoped tenancy.** Row-level (org_id) now, as core
  does; schema-per-org / DB-per-org later for sensitive data (per
  `FINTECH_ARCHITECTURE.md`). Comms holds real user↔client conversations:
  moderately sensitive, core-side, org-partitioned.
- **Cross-component composition — an event spine (later).** When comms must
  react to payments ("invoice paid → send confirmation message"), components
  publish/subscribe domain events rather than call each other directly. Don't
  build it until two components actually need to talk; design module boundaries
  so it can slot in.

## What to take from this

The architecture already answers the hard part; the work is disciplined
modularization, not a new paradigm. Treat each new full-stack component as:

- **(a)** a standards-based web component on the existing embed pipeline, plus
- **(b)** a bounded backend context in the core — own schema namespace, route
  prefix, migrations — hanging off the shared identity/org/token/audit/billing
  spine, plus
- **(c)** a manifest tying the two ends together and declaring scopes + events.

CRM comms is the ideal second full-stack component *because* it exercises the
data-connected path (token exchange, per-user scoping, org-partitioned storage)
on content with no regulatory exposure — the role the docs assigned to payments,
one level up.

## Reference implementations to study

Commercial solutions to our exact "embeddable frontend + dedicated hosted
backend" problem:

- **Stream (getstream.io), Sendbird** — chat/activity feeds as component +
  hosted backend.
- **Liveblocks** — collaborative backend + React components; token-auth model
  very close to ours.
- **Novu** — notifications infra + embeddable inbox.
- **Atlassian Forge** — manifest + vendor-runs-both model we'll trend toward.
- **Stripe / Plaid** — the ephemeral-token exchange we already mirror.

Stream and Liveblocks in particular show a mature version of the
manifest + scoped-token + hosted-backend triad we'd build.
