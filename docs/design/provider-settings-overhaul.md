# Provider settings overhaul + fix ledger

Status: design + ledger (2026-09-23). Owner: "record every problem, fix them all this time." Build
test-first. Gas/exhaustion detail lives in `public-free-tier-inference.md`; this is the umbrella.

## Problem ledger (all found this session)

| # | Problem | Where | Fix |
|---|---------|-------|-----|
| 1 | BYOAI save dumps a raw ZodError to the UI (`path:["owner"],["settings"] invalid_type`). | `app/src/lib/admin/use-byoai.ts:89` validates `PUT /byoai` response with `MeViewSchema` (`{owner,settings}`), but the endpoint returns the **settings slice** `{ai,byoai,monitoring_enabled}` by design (`backend/.../admin/byoai.go:5`). | Validate against `SettingsViewSchema` (result is unused — a `/me` refresh follows). Confirm no other `adminAPI.*` call uses the wrong schema. |
| 2 | Groq provider 404s: client posts `POST /openai/chat/completions`. | The eino OpenAI-compat client appends only `/chat/completions`; the `groq` preset `base_url` is `https://api.groq.com/openai` (missing `/v1`). `backend/internal/conversation/inference/presets.go` + `cmd/server/port/ai_provider.go`. | Set the `groq` preset base_url to `https://api.groq.com/openai/v1`. |
| 3 | Groq 400: `property 'reasoning_content' is unsupported`. | Reasoning models (Groq `gpt-oss-*`) return `reasoning_content`; echoing it back on the next turn's assistant message is rejected. Survives only via force-final fallback. `backend/internal/conversation/inference/eino_model.go` (near `contentGuardModel`). | Add a guard that strips `reasoning_content` from outgoing assistant messages, mirroring `contentGuardModel`. |
| 4 | Gas tank never auto-resets → no daily free-tier budget. | `provider_gas.go` (manual pool only). | `gas_refill_cron` column + a checker job. Detail: `public-free-tier-inference.md`. |
| 5 | No admin **Provider settings** section; `providers.create` is panel/MCP-only; the public tier has no UI knob; code→provider isn't surfaced. | admin nav + `app/src/components/admin/sections/*`; backend `owner_providers` + ops already exist. | Build the section (below). |
| 6 | Upstream 429 surfaces as a generic 500 (sentinels defined, never produced). | `backend/internal/conversation/inference/errors.go`, `eino_model.go:142`. | Map upstream 429 → `ErrRateLimited` (optional backstop). |
| 7 | (verify) Public BYOAI enable-gate may not be enforced server-side — the session issuer keys off the request field, not the owner's `BYOAISettings.Enabled`. | `backend/.../conversation/usecase/visitor_public.go` (sessions issue). | Verify; if unenforced, reject BYOAI at session issue when the owner disabled it. |
| 8 | Provider row shows **"充值" (recharge) + raw token count + "移除计量"** — misframed. Gas is a token-budget cap, not a purchasable balance, so "recharge" reads as money. It also shows on the owner's paid **default** provider, where a token budget is meaningless. | admin provider row UI (the `providers` section). | Reframe: no "充值". Show gas as an optional **"token budget + refill schedule (`gas_refill_cron`)"**, and surface it only for a **metered / public** provider, not the paid default. "移除计量" = clear the budget (`gas_tokens=null`, unmetered) — keep, relabel plainly. |
| 9 | The gas/budget control is opaque — "gas" is internal jargon; a visitor of the panel can't tell what it does. | admin provider row UI. | Relabel "gas" → **"token budget"** in the UI, and add a **hover tooltip** explaining it in plain words: a self-set cap on how many tokens this provider may spend per period; it refills on the schedule; when spent, visitors are asked to get a code or bring their own key. Applies to every non-obvious control in the provider row (default / public markers too). |

## Provider settings model (owner's spec, mapped to what exists)

Owner's words: a **Provider settings** area under nav; **codes attach a provider**; providers have a
**default**, and a code with none **falls back to default**; plus a **public** option.

This is almost entirely the EXISTING resolution `byoai > code > (role) > default`, just given a real
admin surface. Mapping:

- **Provider list + default** — `owner_providers` with `is_default` (one, enforced by a partial
  unique index) ALREADY EXISTS. Ops `providers.list/create/update/delete/set_default` exist. New: an
  admin **section** to drive them (add key, endpoint, model, gas tank + `gas_refill_cron`, pick
  default, pick public).
- **Code → provider, else default** — `access_code.ProviderID` ALREADY EXISTS and already falls back
  to default when null (`resolveSessionProviderID`). New: surface a provider picker in the code
  editor (blank = "use default").
- **Public option** — the anonymous tier resolves from the stored `public` role's `ProviderID`
  (`buildRoleSnapshotForOwnerPublic`). "Public option" = set that provider (+ `GasMetered` for a free
  tier), driven from the Provider section. No new column — reuse the public role.

So the section is mostly UI over existing backend: **provider list (CRUD + key + model + gas +
refill cron), a default marker, a public marker, and a provider picker on codes.** New backend =
only the gas-refill cron (#4) + the two compat fixes (#2, #3) + the BYOAI schema fix (#1).

## Admin UX

- New nav entry **Providers** (its own section under settings), listing provider rows: label,
  provider preset, model, key status, and two radio-style markers **default** / **public**.
- **No "充值".** A provider's budget shows only when it is **metered** (the public/free tier): an
  optional **token budget** + a **refill schedule** (`gas_refill_cron`, e.g. daily). Clearing it
  (`gas_tokens=null`) makes the provider unmetered. The paid **default** provider shows no budget
  control by default (a token cap on your own paid key is meaningless).
- The **codes** editor gains a provider dropdown (options = the provider list; blank = default).
- The BYOAI panel stays; fix its save schema (#1).

## Test matrix (build test-first, blackbox e2e — drive user actions, assert visible markers)

1. BYOAI save: toggle a provider, click save — the panel shows a success/persisted state and **no
   raw error text** (`invalid_type` / `path` must not appear); reopening shows the saved value. RED
   on current code (shows the ZodError).
2. Provider section: create a provider, set it default; a second provider; switching default moves
   the marker and only one is default.
3. Code without a provider uses the default; a code with a provider attached uses that provider
   (assert via the mock stack which endpoint/model the turn hits).
4. Public marker: setting a provider as public routes an anonymous public turn to it; owner/coded
   turns are unaffected.
5. Groq/OpenAI-compat: with endpoint `…/openai/v1`, a turn reaches `/openai/v1/chat/completions`
   (not `/openai/chat/completions`). RED on the current preset base_url.
6. `reasoning_content` is stripped from outgoing assistant messages — a multi-step turn against a
   strict endpoint does not 400. RED on current code (400 → force-final).
7. Gas auto-refill (see `public-free-tier-inference.md` matrix): budget re-opens after the cron tick.
8. Migration: existing volume upgrades; new columns default to today's behaviour.

## Guards written (test-first, before impl)

Written and RED against current code (run when implementing):
- `e2e/test/byoai-save-clean.spec.ts` — #1 (BYOAI save shows no raw ZodError, persists).
- `e2e/test/provider-routing-per-tier.spec.ts` — #5 routing: code→provider, code→default fallback,
  public-role→public provider (reads the mock gateway recorder's `model`).
- `backend/…/inference/presets_groq_test.go` — #2 (groq preset base includes `/openai/v1`).
- `backend/…/inference/sanitize_test.go` + `sanitize.go` seam (no-op, wired) — #3 (strip
  `reasoning_content` from outbound messages).

Remaining guards are written as the FIRST step of their item (they reference testids / mock
features / a cron trigger that are part of that item's build — writing them now would be guessing):
- #4 gas auto-refill: a pure `dueForRefill(cron, filledAt, now)` unit test + an e2e that a refilled
  budget re-serves — written with the checker job (so the func isn't dead code).
- #8 budget UI reframe (no "充值", tooltip, hidden on paid default) — e2e in `api-mcp`, written with
  the `ProviderGasControl` relabel + new testids.
- #9 public exhaustion CTA (visitor sees get-a-code / BYOAI) — visitor e2e, written with the new
  CTA testid.
- #6 (optional) upstream 429 → clean `rate_limited` (mock `scriptMockRateLimit` exists).
- #7 verify BYOAI server-side enable gate.

## Implementation status (2026-09-24)

VERIFIED GREEN:
- #1 BYOAI raw-error — fix (SettingsViewSchema) + testids; `byoai-save-clean.spec.ts` GREEN.
- #2 groq `/v1` preset — fixed; proven by live `make eval-ask`.
- #3 reasoning_content strip — `stripReasoningContent` wired into contentGuardModel; mock gateway
  now emits reasoning + flags it; `reasoning-content-stripped.spec.ts` RED observed on old backend,
  GREEN on the fixed backend.
- #5 routing — `provider-routing-per-tier.spec.ts` GREEN (code→provider / →default / public→provider);
  confirms the public-tier provider works today (public role's provider_id), so #5 "public option" is
  just a UI knob.
- #4 gas auto-refill — BACKEND COMPLETE + builds + unit GREEN: schema col `gas_refill_cron`,
  migration `2026-09-24-provider-gas-refill-cron.sql`, sqlc regen, repo (ListRefillableProviders /
  BumpGasFilledAt), `dueForRefill`/`validRefillCron` (unit-tested cron semantics), `RunGasRefill` +
  `GasRefillPeriodicJobs` (wired into collectPeriodicJobs, 5-min checker), providers.update accepts
  + validates `gas_refill_cron`.

REMAINING (gated on a backend rebuild + stable Docker):
- #4 migration upgrade-path test on a POPULATED volume (MANDATORY before ship — [[schema-lives-in-the-volume]]).
- #4 e2e: budget exhausts → refill tick → re-serves.
- #8 budget UI reframe (no "充值"; "token budget" + refill-cron field + tooltip) + guard.
- #9 public exhaustion CTA (get-a-code / BYOAI on gas_exhausted) + guard.
- Full relevant guard suite green on the rebuilt stack, then SHIP (merge main → tag → CircleCI →
  instance_upgrade).

## Build order

1. Fixes #1 (BYOAI schema), #2 (groq `/v1` preset), #3 (`reasoning_content` guard) — small, clear,
   each with a RED guard first. #2/#3 are reproducible via `make eval-ask` against Groq.
2. Provider settings section UI + code provider picker + public marker (mostly surfacing existing
   ops).
3. Gas `gas_refill_cron` column + checker job (+ `robfig/cron/v3`).
4. Optional: #6 (429 classification), #7 (verify BYOAI server gate).
