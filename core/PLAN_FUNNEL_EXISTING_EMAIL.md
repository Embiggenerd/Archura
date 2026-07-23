# Core plan: the funnel is registration — existing emails get "sign in"

Igor's product decision (2026-07-23): the anonymous front-page funnel
(email + site name, account minted at confirmation) **is the registration
path**. Standard registration semantics therefore apply: an email that
already has an account is not "registered" again — it is told to sign in and
publish from its account. The worker/UI half is implemented and dormant: it
activates on the error code below.

## Change

`POST /v1/confirmations` (handleCreateConfirmation, accounts.go): **only when
`subdomain` is present** (the funnel-deploy flavor), look up the normalized
email; if an account exists → `409 {"error":{"code":"account_exists",
"message":"This email already has an account. Sign in to publish."}}`.

- The **no-subdomain flavor is untouched** — that flavor IS sign-in, and
  existing emails are its whole purpose.
- Keep the rate-limit checks BEFORE the account lookup: they are what keeps
  this from being a cheap account-existence oracle (5/hour/email,
  30/hour/IP). The enumeration trade-off is accepted by Igor — product
  clarity over oracle hardening at this scale.
- No new store method needed if `AccountByEmail` fits; treat lookup errors as
  internal errors, not as "no account".

## Enforcement point: creation-time only (explicit decision)

The review found a race: an email can be new at confirmation-create, gain an
account via a different confirmation, and then the original funnel token
still verifies — `VerifyConfirmation` deliberately upserts, so the site
binds into the now-existing account. **Accepted, deliberately.** The same
human controls the email throughout (no takeover), and the race's outcome is
benign: the site lands in the account that user just created, with that
account's fresh limits — which is precisely where a signed-in publish would
have put it. The policy's purpose (don't let a knowingly-existing email
start the anonymous path, with its confusing downstream failures) is served
at creation time; verification-time enforcement would add a second
`account_exists` surface on `/confirm` for no product gain.
[Flagged for Igor's veto — if he wants strict enforcement, verification must
also check, and the Worker's confirm page needs an `account_exists` branch.]

## Also

- OpenAPI: **no change needed** — `/v1/confirmations` already declares a 409
  response (openapi.json:734). Optionally document the `account_exists` code
  value; not required.
- Tests: subdomain + existing email → 409 `account_exists`; subdomain + new
  email → 201; **no subdomain + existing email → 201** (sign-in must keep
  working — this is the regression that would hurt most);
  **rate-limited request → `AccountByEmail` is never called** (pins that
  limits stay in front of the lookup, keeping the oracle expensive);
  **`AccountByEmail` failing with anything but ErrNotFound → 500 and no
  confirmation created** (lookup errors are not "no account").

## Worker/UI contract (already landed, for reference)

On the funnel deploy, a confirmation-create failure with code
`account_exists` → the worker cleans up the site reservation (shared
meta-last cleanup) and returns 409 with the code; the publish modal shows
"That email already has an account — sign in to publish from it." Any other
non-429 failure keeps the generic 502. Until core ships this, behavior is
unchanged (the code never appears).
