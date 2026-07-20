# Articles App — Design

The first **collection-backed application**: a knowledge/writing app with a Markdown editor,
an articles list page, and individual article pages. It is the concrete case that turns
Archura from "styled pages" into "styled, data-driven, AI-discoverable knowledge," and the
first consumer of the generic **collections** layer referenced in `EDITOR_PARITY.md` §6.

The design is **Markdown-canonical**: the Markdown *is* the product (portable, human- and
machine-readable, ideal for math and for AI consumption), and HTML is derived from it. This
makes it well-suited to knowledge domains — physics and other STEM — where LaTeX math and an
interlinked concept graph matter, and where authors want their work **discoverable and
citable by AI systems** (see [AEO](#answer-engine-optimization-aeo)).

This doc supersedes the one-line stub in `EDITOR_PARITY.md` §6 and resolves the decisions it
left open.

## Roles

- **Platform admin (you)** — creates the tenant (`POST /v1/clients`, see `CORE_SERVER.md`).
- **Tenant / builder** — composes and *styles* the app in the editor. Works on the
  **artifact** (design-time). Never writes article content in production.
- **Writer (end-user)** — the tenant's customer. Writes articles in Markdown. Works on
  **records** (run-time). Identity + scoped tokens per `AUTH_ARCHITECTURE.md`.
- **Reader (anonymous / AI crawler)** — reads published articles as HTML or raw Markdown.

## The two editing planes (the framing)

Everything below depends on not conflating these:

| Plane | Who | Tool | Writes to | Example |
| --- | --- | --- | --- | --- |
| **Design-time** | builder | Archura editor | canonical **artifact** (R2 `ARTIFACTS`) | fonts, spacing, the article *template* + list-page layout |
| **Run-time** | writer | `<archura-article-editor>` in the deployed app | **records** (core collection) | the article title + Markdown body |

"Style the way it looks" = artifact + the `styleParts`/`--custom-prop` contract.
"Write an article" = a Markdown record in core. An article page = **template artifact +
record, bound at render.**

---

## Decision 1 — Storage: core records with a **Markdown-canonical** body

The choice is two axes: substrate (loose files vs. database records) × body format (Markdown
vs. structured JSON).

### Options

- **A. Loose Markdown files in R2** (git/file-based CMS; what the §6 stub implied).
  - *Pros:* trivial; portable; matches the publish-to-snapshot model.
  - *Cons:* no queries — the list page must `LIST` + scan; no row-level authz/ownership; no
    backlink graph without a scan; unsafe under concurrent edits; doesn't scale to UGC.
- **B. Core records, body = structured JSON (ProseMirror).**
  - *Pros:* precise editing model; DB benefits.
  - *Cons:* JSON is **not** the deliverable — every AEO/export path needs a JSON→MD
    conversion; math and wikilinks need bespoke schema nodes.
- **C. Core records, body = Markdown text.** *(chosen)*
  - *Pros:* Markdown is **canonical and is the AEO deliverable** (serve it raw to AI, render
    it to HTML for humans); LaTeX math is just text; `[[wikilinks]]` are just text; portable
    and git-exportable; **keeps** DB benefits — queries, row-level authz, transactional
    draft→publish, a derived backlink graph.
  - *Cons:* less structural precision than JSON (fine for prose/knowledge); Markdown can
    embed raw HTML, so it **must be sanitized on render**; true WYSIWYG is harder — you ship a
    (live-preview) Markdown editor, not a block editor.

### Decision

**C.** "Markdown files" from the old stub was the right *format* instinct, wrong *substrate*.
Store the Markdown **as a text column in a core record**, not as a loose file — you get the
DB guarantees *and* Markdown-as-truth. HTML and the raw `.md` are both **derived** from it at
publish.

### Where each representation lives

```
core / Postgres   : article records (source of truth; body = Markdown text)
                    + derived `links` edge table (the [[wikilink]] graph / backlinks)
R2 ARTIFACTS      : the article *template* + list-page design (builder-authored)
R2 (snapshots)    : rendered published HTML per slug + raw .md + /llms.txt + images (derived)
```

Mental model: **core is truth, R2 is derived + binary.** Losing an R2 snapshot is harmless —
re-render from the record.

### Record schema (code-authored collection)

Per GAPS §3 ("in code, no drag-and-drop"), the collection **schema is authored in code**, not
defined freeform by writers:

```jsonc
// collection "articles", tenant-scoped
{
  "id":          "art_…",
  "slug":        "how-to-cool",       // from frontmatter or derived from title; unique per tenant
  "title":       "How to Cool",
  "frontmatter": { /* parsed YAML: tags, aliases, summary, … */ },
  "body":        "# How to Cool\n\nWhen $T$ drops, [[entropy]] …",  // Markdown — source of truth
  "tags":        ["thermodynamics"],  // denormalized from frontmatter for querying
  "author_id":   "usr_…",             // from the scoped token, never client-supplied
  "status":      "draft | published",
  "published_at":"…", "created_at":"…", "updated_at":"…"
}
// derived: links(from_id, to_slug, to_id?)  — resolved [[wikilinks]] power backlinks + graph
```

---

## Decision 2 — Authoring: locked template, free document

### Options

- **A. Locked template, free document.** *(chosen)* The list page and article template are
  builder-authored and **structurally locked** (the `PageBase` model from GAPS §3:
  `draggable/droppable/removable/copyable: false`). The writer's freedom is the Markdown
  **document** — freeform prose/math/links, which is *content*, not page structure.
- **B. Fully free composition.** Writers add / move / remove components per page.
  - *Cons:* reverses GAPS §3's explicit product decision ("No blocks panel. No
    drag-and-drop.") and the product-vision memory; breaks the locked-structure guarantee.
    **Rejected.**

### Decision

**A — locked where it's structure, free where it's content.** GAPS §3 extended to a data app:
the builder composes structure in code; the writer edits only what the code exposes — here, a
Markdown document. The "very free" impulse is satisfied exactly where it belongs (authoring
knowledge) and the guardrails hold where they belong (site structure).

---

## Components

All are Lit custom elements registered into the catalog (GAPS §2). They inherit `Base`
(`client-key` + `api`), reaching the tenant's data the same way `StripePayment` does.

### `<archura-article-editor>` — the writer's surface (light DOM)

- **Light DOM** (`createRenderRoot() { return this }`), same rationale as `StripePayment`:
  the editor engine's selection/focus APIs misbehave in a shadow root.
- Wraps a **Markdown editor** (CodeMirror 6) with **live preview**, **LaTeX math preview**
  (KaTeX), and **`[[wikilink]]` autocomplete** against the collection. Not a full Obsidian
  clone — a good Markdown editor first; graph view later.
- **Props:** `client-key`, `api`, optional `article-id` (edit vs. new).
- **On save:** persists the Markdown body + parsed frontmatter via the edge → core. Secret
  never in the browser; the writer holds a short-lived **scoped token** (`AUTH_ARCHITECTURE.md`).

### `<archura-article-list>` — the collection component

- **Props:** `client-key`, `api`, `collection="articles"`, `sort`, `filter`, `tag`, `page-size`.
- Fetches published records and repeats an **item template** (bind the existing `Card`),
  each linking to `/articles/:slug`. Cursor pagination. Can also render tag/graph views.

### `<archura-article>` — the detail template (data-bound)

- Reads the slug from the route, renders the record's **Markdown → HTML**, applies builder
  styling. This is what the builder styles design-time and what gets snapshotted at publish.

---

## Markdown pipeline (MD → HTML)

Deterministic, at publish time, via **unified (remark/rehype)**:

- **remark-parse** + **remark-frontmatter** (YAML) → metadata synced to record columns.
- **remark-math** + **rehype-katex** → LaTeX (`$…$`, `$$…$$`) rendered to HTML/MathML.
- **wikilink resolver** — `[[slug]]` / `[[slug|alias]]` → internal links + collected into the
  `links` edge table; unresolved links render as "stub" links (Obsidian behavior).
- **code highlighting** (rehype-highlight / Shiki) — useful for physics/code snippets.
- **rehype-sanitize** with an allowlist — Markdown may embed raw HTML; **never trust it**.
- The styled HTML then flows through `transformForDeployment`, which inlines the deployable
  custom-property styles into the snapshot.

## Data flow

**Write path.** `<archura-article-editor>` → edge `/api/collections/articles` (attaches tenant
scope from `client-key`, verifies the writer's scoped token) → core CRUD → Postgres. On
**publish**, the edge/core renders MD → HTML snapshot, writes the raw `.md`, updates
`/llms.txt`, and recomputes the `links` graph.

**Read path (published).** Reader/crawler → edge route → **R2 snapshot served static** (free,
no worker CPU): HTML for browsers, raw `.md` via content negotiation for AI. The list page
reads a cached list snapshot, or on miss queries core.

## Rendering & cost

**Render at publish, not at read.** Published articles change rarely, so render once → R2, and
reads are free static-asset serves. The worker runs only for dynamic routes: `/write`, draft
previews, authenticated pages. Turn off `run_worker_first` for cacheable article paths so
static serving short-circuits the worker. Cost scales with *uncached dynamic requests*
(writers only), not with pageviews.

## Answer-Engine Optimization (AEO)

The reason for Markdown-canonical: make knowledge maximally consumable by AI. **Honest scope:**
you can optimize for **retrieval/citation at inference** (RAG, AI search, browsing agents) and
make content **crawlable so it is *eligible* for training** — you **cannot** guarantee
inclusion in any model's weights; that is the provider's decision. Sell the former, not the latter.

- **Raw Markdown via content negotiation** — same URL, serve `text/markdown` when the request
  sends `Accept: text/markdown`, else HTML. Avoids a duplicate indexable URL.
- **`/llms.txt`** (llmstxt.org) — generated at publish: a curated index of articles (title,
  summary, link), optionally linking the `.md` bodies.
- **Crawler policy** — allow `GPTBot`, `ClaudeBot`, `Google-Extended`, `PerplexityBot` in
  robots.txt; `noindex` any standalone `.md` URL to avoid duplicate content with the HTML.
- **Structured data** — JSON-LD `ScholarlyArticle`/`Article` (+ `DefinedTerm` for concept
  pages) in the HTML `<head>`; benefits both AI and classic SEO.
- **The wikilink graph** — explicit `[[concept]]` relationships are strong signal for AI
  retrieval and double as internal linking for SEO.

## Routing & SEO

- Routes: `/articles` (list), `/articles/:slug` (detail), `/write` + `/write/:id` (editor, auth).
- Served by `site-worker.js` path routing (multipage, GAPS §7) or a per-tenant wildcard
  subdomain (GAPS §7, ~line 305).
- **Classic SEO** (the real ranking work — put budget here, not on the `.md`): per-article
  `<title>`/description/OG via the `content.page` mechanism (`EDITOR_PARITY.md` §7), **JSON-LD
  `ScholarlyArticle`**, **sitemap.xml**, **canonical URLs**. Published snapshots are pure SSR
  HTML + inlined styles — indexable, zero client JS to read.

## Core endpoints (new — generic collections)

Edge `/api/*` proxies to core `/v1/*`, adding tenant scope + token verification:

```
POST   /v1/collections/articles                 create draft   (scoped token: articles:write)
PUT    /v1/collections/articles/:id             update         (owner or tenant admin)
POST   /v1/collections/articles/:id/publish     draft→published (+ snapshot/.md/llms.txt/graph)
POST   /v1/collections/articles/:id/unpublish   published→draft (+ derived-output cleanup)
GET    /v1/collections/articles?status=&tag=&sort=&cursor=&limit=   list (public for published)
GET    /v1/collections/articles/:slug           detail (public if published; owner if draft)
GET    /v1/collections/articles/:slug/backlinks graph edges into this article
DELETE /v1/collections/articles/:id             delete
```

## Authz

- **Writes** require an end-user **scoped token** (`AUTH_ARCHITECTURE.md` — minted by the
  tenant backend/edge, never the tenant secret in the browser). `author_id` comes from the
  token, never the request body.
- **Published reads** are public (HTML + `.md`). **Draft reads** are restricted to the owning
  writer or a tenant admin.
- **All queries** are tenant-scoped by `client-key`; cross-tenant access is impossible by
  construction, consistent with `FINTECH_ARCHITECTURE.md` trust boundaries.

## Still ahead (undesigned)

Graph-view UI; equation numbering/cross-refs; citations/bibliography (BibTeX, DOIs);
scheduled publish; revision history; multi-author collaboration; media upload pipeline
(images → R2); full-text + semantic **search** (needs an index); i18n. "Composer mode"
(GAPS §7) could later let a builder define *new* collections/schemas — out of scope; schemas
stay code-authored.

## Verify

1. Writer creates a draft → record exists, `status=draft`, `author_id` from token, not public.
2. Writer saves Markdown with `$…$` math and a `[[link]]` → body persists; server sanitization
   strips an embedded `<script>`.
3. Publish → HTML snapshot + raw `.md` + `/llms.txt` written to R2; `[[link]]` resolved into
   the `links` table and appears in the target's backlinks.
4. `GET /articles/:slug` → static HTML, math renders (KaTeX), OG/JSON-LD present, **no editor
   JS loaded**; `Accept: text/markdown` on the same URL returns the raw Markdown.
5. List page → only published articles, correct sort/tag filter/pagination.
6. Builder restyles the article template → republish → snapshot reflects new styling; the
   record body (Markdown) is unchanged (content/theme separation holds).
7. Cross-tenant read of another tenant's draft → denied; standalone `.md` URL is `noindex`.

## Suggested order

1. Core: generic collections CRUD + `articles` schema (Markdown body) + tenant scoping + token verify.
2. `<archura-article-editor>` write path (CodeMirror MD editor, frontmatter, sanitize).
3. Markdown pipeline (remark/rehype + KaTeX + wikilink resolver + `links` graph).
4. Publish → render → R2 write-through (HTML + `.md` + `/llms.txt`); serve on read + content negotiation.
5. `<archura-article-list>` + `<archura-article>` templates (builder-styled, locked); JSON-LD + sitemap.
6. Backlinks/graph, draft preview, unpublish/delete; then the "Still ahead" layers.
