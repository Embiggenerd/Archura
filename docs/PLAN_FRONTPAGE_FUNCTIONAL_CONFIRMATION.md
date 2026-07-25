# Front-page functionality and confirmation handoff

## 1. Why we are doing this

The redesigned front page changed the product entry point from redirecting to
`/edit/` to presenting an inline editor on `/`. The redesign work focused mainly
on presentation, so the existing product behavior was not fully revalidated.
Important functionality, including the editor rendering at all, is currently
unreliable.

The existing client-registration E2E test still expects `/` to redirect to
`/edit/`. It therefore bypasses the redesigned front page and cannot catch
front-page regressions such as an empty editor.

The confirmation journey also has a stale-tab problem. The email confirmation
tab creates the session and opens the newly published site, but the original
envelopment.ai tab remains on “Check your email” because it never rechecks
authentication.

Production uses split domains: the app lives on `envelopment.ai`, while
published sites and the configured confirmation URL use `archura.ai`. The
Worker currently redirects a request to the bare sites domain to `APP_ORIGIN`
while preserving its path and query. Consequently,
`https://archura.ai/confirm?token=...` must reach
`https://envelopment.ai/confirm?token=...` before confirmation runs, so the
session cookie is set by the app domain. Local single-origin E2E coverage does
not prove this production invariant, so the redirect needs its own regression
check.

This work should restore the intended front-page experience:

- The inline editor renders and is usable.
- The redesigned controls perform their intended actions.
- Anonymous editing, registration, publishing, and confirmation work from `/`.
- The confirmation tab opens the published site.
- The original “Check your email” tab recognizes the confirmed session and
  redirects to `/dashboard/`.
- The current visual redesign is preserved except where a functional fix
  requires a small layout correction.

## 2. Summary of the implementation plan

First, audit the redesigned front page in both local development modes: Vite for
editor behavior and the built Worker for the real authentication and publishing
APIs. Reproduce the blank editor, inspect browser errors and editor
initialization, compare it with the working `/edit/` mount, and fix the
underlying issue surgically.

Then validate every functional control introduced or retained by the redesign:
Start building, Register, Page/Component selection, Publish, preview rotation,
and the inline editor itself.

Update the outdated user-story test so it exercises the inline editor on `/`
instead of expecting a redirect to `/edit/`. Finally, add the
confirmation-session watcher, test the complete two-tab journey, and verify
that the split-domain confirmation redirect preserves the token and lands on
the app origin.

## 3. Actual implementation plan

### 3.1 Establish the redesigned front page's functional contract

The signed-out `/` page must:

- Remain on `/` rather than redirecting to `/edit/`.
- Render the existing redesigned marketing content.
- Mount an `<archura-editor>` inside `[data-editor-mount]`.
- Display a visible editor canvas containing the default Landing page.
- Allow content in the canvas to be edited.
- Scroll to `#editor` when “Start building” is clicked.
- Open registration from the header Register button.
- Keep Page selected by default.
- Open registration when the unavailable “Component · Basic” option is
  selected.
- Open the deployment modal from Publish.
- Continue rotating the product preview without browser errors.
- Preserve the existing signed-in `/` to `/dashboard/` server redirect.

### 3.2 Audit the front page in the browser before changing code

Test both environments because component loading differs between them:

- Vite front page: editor rendering and ordinary client behavior.
- Built Worker front page: production module URLs, `/api/*`, registration,
  deployment, confirmation, and sessions.

For each environment:

1. Load `/` while signed out.
2. Record console exceptions, `pageerror` events, and failed module or asset
   requests.
3. Inspect whether `archura-editor` was registered with `customElements`.
4. Confirm `[data-editor-mount]` contains the editor element.
5. Check whether the editor emits `editorready` or `editorerror`.
6. Inspect the editor shadow root, shell, canvas iframe, and computed height.
7. Check whether the default Landing component and its modules loaded.
8. Compare the setup with the known working mount in
   `archura-editor/edit/index.html`.

Do not guess at the blank-editor cause before collecting this evidence.

### 3.3 Fix the inline editor

Work in `archura-editor/index.html` and trace the failure through these
boundaries:

- The `./src/index.ts` import completes.
- The `archura-editor` custom element is registered before or shortly after
  insertion.
- `componentPath`, `components`, and any required persistence configuration
  are assigned correctly.
- Development uses source component definitions.
- The production build uses valid `/components/...` module URLs.
- The controller initializes successfully.
- The editor host, shadow shell, and iframe receive usable heights.
- Front-page CSS does not hide or collapse the editor.

Reuse the minimum proven setup from `/edit/` where necessary. Do not duplicate
the whole `/edit/` application or introduce a second editor implementation.

Preserve the current redesigned markup and styling. Only change CSS when
computed layout proves it is responsible for the editor being invisible.

### 3.4 Audit and repair the redesigned controls

Verify each control through user-visible behavior:

- “Start building” scrolls to the inline editor.
- Header Register opens the registration modal.
- Page remains selected and updates `aria-pressed` correctly.
- Component Basic opens registration without corrupting Page selection.
- Publish opens the deployment modal using the mounted editor's current state.
- Editing before Publish is reflected in the artifact sent for deployment.
- The preview rotator advances, pauses, and resumes without exceptions.
- Remove the leftover `console.log(previewSlides)` from
  `archura-editor/index.html`.

Fix reproducible bugs directly affecting this front-page journey. Mention
unrelated defects discovered during the audit, but do not expand into unrelated
refactoring.

### 3.5 Update the obsolete front-page E2E expectation

In `e2e/stories-client-registration.mjs`:

1. Remove the expectation that `/` redirects to `/edit/`.
2. Assert that the page stays on `/`.
3. Wait for `[data-editor-mount] archura-editor`.
4. Wait for the inline editor's canvas iframe and default Landing content.
5. Edit a distinctive piece of content and assert that the edit commits.
6. Use the redesigned front-page Publish control rather than selectors
   belonging only to `/edit/`.
7. Preserve the invalid-email, deployment, publication, and live-content
   assertions.

Update the corresponding table in `e2e/README.md` so it describes the inline
front-page editor instead of the old redirect.

### 3.6 Add session detection to the shared check-email state

In `archura-editor/edit/funnel-ui.js`:

1. Add a private helper that displays `checkEmailHtml(email)` and watches for
   confirmation.
2. Listen for the waiting page to regain window focus or become visible.
3. On those events, request `/api/me`.
4. Prevent concurrent duplicate requests.
5. Redirect with `location.assign('/dashboard/')` only when:
   - `/api/me` succeeds.
   - Its returned email matches the submitted email case-insensitively.
6. Ignore `401`, malformed responses, other non-success responses, and
   temporary network errors.
7. Detach listeners after success or after detecting that the overlay is no
   longer connected.

Do not inspect the HttpOnly cookie, continuously poll, or introduce cross-tab
messaging.

### 3.7 Use the helper for both check-email transitions

Start watching only after the initiating request succeeds:

- Successful registration.
- Successful anonymous deployment.

Do not change confirmation creation, token handling, or error messages
unrelated to this behavior.

### 3.8 Preserve confirmation routing

In `archura-editor/workers/site-worker.js`:

- The confirmation tab should continue setting the session cookie.
- A successful deployment confirmation should continue opening the published
  site.
- The original envelopment.ai tab should independently redirect to
  `/dashboard/` after detecting the session.
- Do not replace the published-site redirect with a dashboard redirect.
- Preserve the split-domain request chain:
  `archura.ai/confirm?token=...` to
  `envelopment.ai/confirm?token=...` to the published site.
- Confirm that the first redirect preserves both `/confirm` and the complete
  token query string.
- Confirm that `handleConfirm` executes on `envelopment.ai`, making the
  `archura_session` cookie an app-domain cookie visible to the waiting tab.
- Do not change `CONFIRM_URL_BASE` merely because it names `archura.ai`. Under
  the current split-domain design, that URL is valid because the bare
  `archura.ai` Worker route redirects to `APP_ORIGIN` before confirmation is
  handled. Change the configured origin only if browser evidence shows the
  production redirect is absent or no longer part of the intended domain
  design. Any actual production environment change and redeployment remains
  the developer's responsibility.

### 3.9 Add the two-tab regression test

Extend the redesigned front-page story using two pages in the same browser
context:

1. Keep the original `/` page on “Check your email.”
2. Bring it back into focus before confirmation and assert it does not
   redirect. This proves that focus alone cannot authenticate a user.
3. Open the email confirmation URL in a second page.
4. Assert the second page reaches the published site and displays the edited
   marker.
5. Bring the original page to the foreground.
6. Wait for it to navigate to `/dashboard/`.
7. Assert the dashboard shows the same email used for deployment.

Apply the same pattern to the registration story if it can reuse the setup
cleanly. At minimum, the deployment flow must cover the reported bug.

Also extend the Worker routing checks in
`archura-editor/scripts/verify-ops-fork.mjs`:

1. Request `https://archura.ai/confirm?token=split-domain-token` with redirects
   disabled and the split-domain test environment.
2. Assert a redirect to
   `https://envelopment.ai/confirm?token=split-domain-token`.
3. Assert the token query is unchanged.
4. Keep this separate from the local two-tab test: the routing check proves the
   production hostname handoff, while the two-tab test proves the browser
   session behavior after confirmation.

### 3.10 Verify the complete change

1. Before implementation, run the focused relevant checks and, if practical,
   the full E2E suite. Record any pre-existing failures so the final result can
   be compared with a concrete baseline rather than assuming the repository is
   currently all green.
2. From `archura-editor`, run `npm run typecheck`.
3. Run `npm run build`.
4. From the repository root, start the local stack with
   `sh scripts/dev-up.sh`.
5. From `e2e`, run `npm run test:stories`.
6. Run the Worker verification containing the new split-domain routing check.
7. If the focused suites pass, run `npm test` from `e2e`.
8. Compare any failures with the recorded baseline. The change must introduce
   no new failures; do not hide or silently reclassify a failure as
   pre-existing.
9. Manually inspect `/` at desktop and narrow viewport sizes to ensure the
   functional fixes did not damage the redesign.
10. Confirm there are no uncaught front-page errors or failed critical modules
   in either Vite or Worker mode.

Do not deploy, create or merge branches, or modify unrelated code. Preserve all
pre-existing local front-page changes unless a specific line must change to fix
one of the verified functional failures above.

## Completion criteria

The work is complete when:

- The inline editor is visible and editable on the redesigned `/` page in both
  Vite and Worker builds.
- All redesigned front-page controls have verified user-visible behavior.
- The front-page E2E test no longer bypasses `/` through the old `/edit/`
  redirect.
- Email confirmation opens the published site in the confirmation tab.
- Returning to the original waiting tab redirects the confirmed account to
  `/dashboard/`.
- Focus without confirmation does not redirect.
- The split-domain confirmation redirect preserves the token and reaches
  `envelopment.ai/confirm` before the session cookie is issued.
- The focused suites pass, and the full relevant test suite has no failures
  beyond its explicitly recorded pre-change baseline.
- No deployment, branch creation, merge, or unrelated refactor was performed.
