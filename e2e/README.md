# E2E ownership

Independent end-to-end suite for the Archura product surface (editor, funnel,
dashboard, deploy/serve). **This folder owns runners and coverage.** It talks
to the running stack over HTTP only — never imports package code, never edits
`archura-editor/`, never calls its verify scripts.

Stack under test: `sh scripts/dev-up.sh` (Worker `:8787`, Vite, core).

**Own the matrix, not just the scripts.** A green run that skipped the path a
human just broke is a failure of ownership.

---

## Layout

| Path | Role |
|------|------|
| `package.json` | Own Playwright dependency (`npm install` here) |
| `lib/harness.mjs` | Checks, probes, browser launch (`HEADED=1`) |
| `stories-client-registration.mjs` | `./docs/USER_STORIES.md` pathways (product gate) |
| `editor.mjs` | Vite editor: load, theme/part style, text, resize, mobile |
| `funnel.mjs` | Broader funnel/technical coverage |
| `run-all.mjs` | Runs every suite; exit 2 = infra missing, 1 = assertion fail |

Suites **hard-fail** (exit 2) when Vite/Worker/core are not ready. They never
SKIP with exit 0.

---

## 1. Mission

E2E exists to catch **product-branch bugs** — the kind a human finds walking the
UI that unit tests and coarse “element visible” checks miss.

For every branch you claim to cover:

1. Enter through the **same UI** a user would (not an API shortcut), unless the
   shortcut is explicitly listed as out of scope for that check.
2. Assert a **user-visible outcome** (copy, live computed style, deployed page
   content), not only HTTP status or “modal opened.”
3. Assert at least one **negative / error** sibling of the happy path on that
   surface (invalid input, forbidden action, expired token, etc.).
4. If the suite cannot run (missing core, servers down), it must **fail** —
   never silent `exit 0`.

Manual bugs found on a walkthrough become checks **before** the fix lands.

---

## 2. Hosts and when to use which

| Host | Port | What it is | Use for |
|------|------|------------|---------|
| Vite | `5173+` (or `E2E_VITE`) | Dev editor, filesystem artifacts | `editor.mjs` |
| Worker (wrangler) | `8787` | Built app + R2 + funnel API | `funnel.mjs` |
| Core | `8080` | Accounts, confirmations, sessions | Required by funnel |

**Critical split:** anonymous Deploy / Claim / Register chrome mounts only when
`import.meta.env.PROD` — i.e. the Worker-served build on `:8787`. Funnel e2e
against Vite will not see that UI.

Bring the stack up with `sh scripts/dev-up.sh` (product under test). Runners
themselves stay in `./e2e`.

Overrides: `E2E_VITE`, `E2E_WORKER`, `E2E_CORE`. `editor.mjs` auto-discovers
Vite on `:5199` / `:5173`–`:5176` when `E2E_VITE` is unset.

---

## 3. Architecture constraints (write careful tests)

### Canvas is an iframe

```js
const frame = page.frameLocator('iframe.gjs-frame');
await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
```

### Nested shadow DOM

Shell chrome is Lit shadow; components usually have their own `shadowRoot`.
Prefer `evaluate` + `getComputedStyle` for style/text truth. Stripe may use
light DOM + `data-part`.

### What “the editor is working” means

| Capability | Pass criteria |
|------------|---------------|
| **Inline text** | Dblclick → type → commit; attribute + canvas match; deploy shows same string |
| **Styling** | Distinctive computed style on host/part (`#00ff00`, `rgb(255,0,0)`) |
| **Resize** | Drag `.gjs-resizer-h-*` writes `--width` / `--height` |
| **Responsive** | Device tab changes frame width; edits land in the right `@media` bucket |
| **Publish / deploy** | Live `/s/<site>/` reflects the edit (not merely “hero visible”) |

### Auth

- Claim token: `localStorage` (legacy path).
- Funnel session: HttpOnly cookie — use separate browser contexts per account.

---

## 4. How to author a suite

1. Draw the decision tree (every leaf: covered / thin / gap / out).
2. Pick host (Vite vs Worker `:8787`); document deps in the file header.
3. Use `createChecks()` / `requireOk()` from `lib/harness.mjs`.
4. Prefer UI for product paths; API only for probes/setup.
5. `trackPageErrors(page)`; unexplained errors should fail.
6. Prove new checks fail before the product fix.
7. Update §5 matrix in this file.

Name checks as human facts: `live site shows the distinctive title…`, not
`hero is visible`.

---

## 5. Branch matrices

Status: **covered** / **thin** / **gap** / **out**. Owner = `./e2e` suite.

Product pathways are sourced from `./docs/USER_STORIES.md`. When a story is
added or changed, update the matching `stories-*.mjs` suite first.

### 5.0 User stories (`stories-client-registration.mjs`)

| Story leaf | Status | Assertion |
|------------|--------|-----------|
| Index → editor | covered | `/` redirects to `/edit/` with canvas |
| Edit then Deploy | covered | Distinctive title commits |
| Invalid email | covered | No advance; validity or error |
| New subdomain + email → check inbox | covered | Check-email UI + `/dev-mail/` link |
| Confirm → Open site → live match | covered | Live card title === edited marker |
| Used subdomain → message | covered | Error; no advance |
| Already-used email → message | failing | Error; no advance — product currently accepts a second deploy (gap) |
| Register button → inbox → dashboard | covered | Signed-in dashboard + claim field |
| Register invalid email | covered | Blocked |

### 5.1 Funnel & account (`funnel.mjs`)

| Branch | Status | Required assertion |
|--------|--------|--------------------|
| Build-first + distinctive edit | covered | Live card `title` === marker typed before deploy |
| Deploy bad email | covered | Modal does not advance; input invalid |
| Drafted loader only | covered | Loader copy + `artifact.json` 404 |
| Confirm via `/dev-mail/` UI | covered | Click link from mailbox page |
| Confirm reused token | covered | “invalid or expired” |
| Promote open-tab flip | covered | Loader → live without manual reload |
| Register-first → claim → publish → embed | covered | Foreign-origin embed renders |
| Cross-account write | covered | 401/403 |
| Unconfirmed deploy never live | covered | Loader only |
| Confirm `site_owned` race | gap | Taken page; no cookie |
| Core unavailable 503 UX | gap | Modal unavailable copy |
| Payment / expiry | out | — |

### 5.2 Editor (`editor.mjs`)

| Branch | Status | Required assertion |
|--------|--------|--------------------|
| Landing loads | covered | Hero visible in canvas |
| Theme background on card | covered | Computed `rgb(0, 255, 0)` |
| Part-level title color | covered | Title red, content not |
| Inline text commit | covered | `title` attribute matches typed string |
| Drag resize → `--width` | covered | Non-empty px/% |
| Mobile narrows frame | covered | Frame width decreases |
| Breakpoint threshold migration | gap | Add suite when needed |
| Style survives reload | gap | Reload then computed style holds |

### 5.3 Still open (add suites under `./e2e`)

Claim-token publish loop, hit-test invariants, client-styling multi-tenant,
Stripe live, legacy `meta` without `status`.

---

## 6. Selector map

| URL | Role |
|-----|------|
| `http://localhost:5173/edit/?component=pages/Landing` (port may vary) | Dev editor |
| `http://localhost:8787/edit/` | Funnel editor (anonymous Deploy) |
| `http://localhost:8787/dashboard/` | Session dashboard |
| `http://localhost:8787/dev-mail/` | Dev mailbox UI |
| `http://localhost:8787/confirm?token=cfm_…` | Magic link |
| `http://localhost:8787/s/<site>/` | Served site / loader |

Funnel chrome: `.deploy-open`, `.modal`, `input[name="site"|"email"]`,
`.publish-panel`, dashboard `.card`.

Canvas: `iframe.gjs-frame`, `archura-hero` / `archura-card`, `.gjs-sm-property`,
`.gjs-resizer-h-cr`.

---

## 7. Running

```bash
# once
cd e2e && npm install

# stack under test (separate terminal)
sh scripts/dev-up.sh

# all suites
cd e2e && npm test

# one suite
npm run test:stories
npm run test:editor
npm run test:funnel

# watch the browser
HEADED=1 npm run test:stories
```


Exit codes: `0` all checks passed · `1` assertion failure · `2` infra not ready.

---

## 8. Checklist — before a branch is “owned”

- [ ] Decision tree drawn; every leaf classified
- [ ] Correct host documented (`5173+` vs `8787`)
- [ ] User-visible end state asserted (distinctive content when claiming sameness)
- [ ] At least one negative sibling
- [ ] No SKIP exit 0
- [ ] Matrix row updated here

---

## 9. Ownership rules for agents

1. Touch only `./e2e` (and `scripts/dev-up.sh` if the stack recipe must change).
2. Update this doc when coverage changes.
3. Do not expand into payment/expiry/custom domains until product docs say so.
4. Do not “fix” flakes by deleting assertions.
5. Wrong host (Vite vs Worker `:8787`) is the most common false confidence — check §2.
