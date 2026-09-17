# The openapi-runtime block — the last supplier becomes a block

Status: **design, 2026-09-17.** The endgame of the supplier fold: no supplier is served by
in-host Go any more. Written before any test or code — the tests below come from THIS design, not
from reading the current Go engine.

## Why

Today three supplier *kinds* serve seams, and only two are blocks:

| kind | example | where it runs today | a block? | on dsh? |
|------|---------|---------------------|----------|---------|
| block (sandbox_stdio) | caldav (calendar), smtp (mail) | a JS MCP block, sandboxed | yes | yes, has a dsh acceptance test |
| openapi | google-calendar, any owner-uploaded SaaS | **in-host Go** (`openapi.Runtime` + `calendarAdapter`/`mailAdapter`) | **no** | **no dsh test — it isn't a block** |
| protocol | (gone — SMTP was the last, now the smtp block) | — | — | — |

The openapi kind is the one thing left that the host executes itself: a Go HTTP engine
(`internal/infra/openapi`) plus a typed `CalendarProxy`/`MailProxy` per seam. That is exactly the
anti-pattern the thesis removes — the host holding a capability's machinery, a per-seam typed
star, and a supplier that can't load on dsh and has no dsh acceptance test. "openapi → CallVerb
unify" does **not** mean "grow a `CallVerb` method on the in-host Go adapter" (a half-measure that
leaves google-calendar in Go). It means: **openapi execution becomes a generic JS block**, and
google-calendar — like any owner-uploaded openapi supplier — becomes *data* that block loads.

## The shape

**One generic block, `infra/plugins/openapi/` (JS).** It is an openapi execution engine: given an
OpenAPI **spec**, a **binding** (how each seam verb maps to a spec operation + request/response
JSONata), and the owner's **credentials merged in per call**, it exposes the seam's verbs as MCP
tools and performs the HTTP calls. It is generic over the supplier the way `blockseam.Provider` is
generic over the block: it names no provider.

**A supplier is data.** `google-calendar` becomes a manifest with `transport: sandbox_stdio`
pointing at the openapi block, carrying its `spec.yaml` + `binding.yaml` in its plugin dir (the same
files exist today; they stop being read by Go and start being read by the block). An owner-uploaded
SaaS is the same: manifest + spec + binding, no code. So the openapi block loads any of them.

**It joins the one mechanism.** Once google-calendar is a sandbox_stdio block, it is assembled by
the same generic `blockSeamSupplier` → `blockseam.Provider` as caldav and smtp — no per-seam Go, no
`CalendarProxy`/`MailProxy`, no `calendarVerbs`/`mailVerbs` dispatch. Every seam call, for every
supplier, is `supplier.invoke(seam, verb, args)` → `Provider.CallVerb` → the block's tool. The
typed openapi adapters and the Go `openapi.Runtime` are **deleted**.

## Contract (what the block's tools must do — the source of the tests)

The verbs and their wire shapes are the seam's, already fixed by the consumer (booker) and shared
with the caldav/smtp blocks — the openapi block MUST emit the identical shapes:

- **calendar** seam:
  - `free_busy({time_min, time_max})` → `{ busy: [ {start, end} ] }` (RFC3339)
  - `insert_event({summary, description, start, end, time_zone, visitor_email})` → `{ eventId, htmlLink }`
  - `delete_event({event_id, attendee_email})` → `{ ok: true }`
  - `verify()` → `{ ok: true }` or a classified fault sentence
- **mail** seam:
  - `send({to, subject, body, html})` → `{ id }`
  - `verify()` → `{ ok: true }` / classified fault

`connected` and `can_perform` are **not** block tools — they are host questions (the connection row
and the grant), answered host-side by the dispatcher, unchanged.

The block does per-op what the Go adapter did, now in JS: build the request from the verb args via
the binding's request JSONata, call the spec operation over HTTP with the merged auth, map the
response via the response JSONata to the canonical shape, generate an idempotency key for the write
op, apply the read/write retry policy, and classify a failure (5xx-permanent → `[fault:rejected]`,
transient → unavailable) the way the smtp block already does.

## Credentials & auth — the boundary

OAuth is the one real subtlety. **Token storage and silent refresh stay host-side** (they need the
instance secret and the connection row; a sandbox block must never hold either). The host refreshes
as needed and **merges the current access token into the call args** (the same way it merges the
caldav password / smtp creds) — the block receives a ready bearer and injects it into the request
per the spec's security scheme. The block performs no OAuth dance and stores nothing. apiKey/bearer
suppliers are simpler: the key is merged in the same way.

So the credential vault path is unchanged (`credmgr` → merged creds); only the consumer moves from
Go to the block. `check-supplier-boundary` still holds: the vault is reached only by the host, which
hands the block an opaque merged blob.

## What moves, what dies

- **New:** `infra/plugins/openapi/` (JS engine: spec parse + JSONata binding + HTTP + retry +
  idempotency + fault classification), its `cordis.patch.yml`, its dsh acceptance test.
- **Changes to data:** `backend/blocks/google-calendar/manifest.yaml` → `transport: sandbox_stdio`
  (node, args openapi wrapper), spec+binding shipped in its plugin dir; the mail-openapi supplier
  likewise if one ships.
- **Deleted:** `internal/infra/openapi` (the Go engine), `adapters/openapi_adapter.go`
  (`calendarAdapter`/`mailAdapter`), the typed `CalendarProxy`/`MailProxy` interfaces + `seam_calendar.go`/`seam_mail.go` DTOs no longer needed host-side, the `calendarVerbs`/`mailVerbs` typed dispatch, `oauthRefresher`'s in-adapter coupling folds to the host-side refresh-then-merge. `blockSeamSupplier` collapses to one generic construction (no `case`), and `block_calendar.go`/`block_mail.go` per-seam proxies go away (blockseam.Provider is the supplier).
- **Booker:** reads the canonical shapes directly (`.busy`; `eventId`/`htmlLink`) — the same change every block-served seam needs.

Net: host-blind → 0 for suppliers (no seam/provider literal, no in-host engine); every supplier is a
JS block on dsh with a dsh acceptance test.

## Tests (derived from this design, decoupled from any implementation)

1. **dsh acceptance test** (`infra/dsh-acceptance/openapi.dsh-testkit.yaml`): the openapi block,
   loaded with a spec+binding fixture, boots on real DSH and **registers the seam verbs as tools**
   (`mcp__openapi__free_busy`, `insert_event`, `delete_event`, `verify`). No exercise — a real call
   needs a live SaaS + token, the same posture as caldav. This is what "google-calendar is a block
   on dsh" means, and it is the missing test today.
2. **UT for the JS engine** (pure, in the block): a request JSONata maps verb args → the spec op's
   request body; a response JSONata maps a sample SaaS response → the canonical shape
   (`{busy:[…]}`, `{eventId,htmlLink}`, `{id}`); a 5xx → `[fault:rejected]`, a timeout → unavailable.
   Fed hand-written spec/binding/response fixtures — no host, no network.
3. **e2e, black-box, unchanged** (the real gate): `chat-book-success` + the policy/conflict/quota
   specs book through google-calendar; `supplier-happy-matrix` openapi-calendar + openapi-mail
   cells; `supplier-provider-agnostic` (booker unchanged when the provider kind changes);
   `visitor-cancel/reschedule-booking` (needs a real event id → the `{eventId}` shape is load-bearing).
   These assert observable booking behavior and must stay green with google-calendar now a block.

## Order

Design (this doc) → tests from it (1, 2, 3 written/identified and RED-able) → JS implementation →
green. This is a multi-day build (a JS port of the openapi engine); it is the last big eiab arc.
