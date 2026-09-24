# Public free-tier inference

Status: design (2026-09-23). Decision locked by owner. Build test-first from the matrix at the end.

## Goal

Serve the anonymous **public** chat from a designated free/rate-limited provider so the owner pays
nothing for public traffic. Groq is the first such provider the owner will plug in, but nothing here
is Groq-specific.

## Locked decision

When the public budget is spent, a public visitor gets a **prompt to get an access code or bring
their own key (BYOAI)** — no fallback to the owner's paid provider. The owner pays $0. Coded and
BYOAI visitors are unaffected.

## Design: reuse what exists; add ONE primitive

The earlier draft reinvented routing, a circuit breaker, and a per-IP/day counter. All of that
already exists. The feature is almost entirely **configuration** of existing mechanisms, plus one
small, general extension of the gas tank.

### Already covered — configuration only (no code)

- **Public routing** — the `public` role is a real, editable builtin role row
  (`role.go:241 PublicRoleName`, seeded by `roles_seed.go:90`). Its `ProviderID` and `GasMetered`
  are settable today via the `role_update` MCP op (`roles_write.go:30,37`), frozen into the public
  session at issue (`visitor_role_snapshot.go:202-203` → `visitor_public.go:96-106`). Set the public
  role's `ProviderID` = the free provider and `GasMetered = true`.
- **Token budget** — the provider **gas tank** already meters spend: `owner_providers.gas_tokens`,
  remaining = `gas_tokens − SpentSince(gas_filled_at)` (`provider_gas.go:36`). Set `gas_tokens` on
  the free provider to the daily budget (`providers_update`).
- **Exhaustion signal** — already a clean `403 {Code:"gas_exhausted"}`
  (`chat.go:163-169`) via `EnforceGasQuota → ErrGasExhausted` (`visitor_gas_quota.go:40`). BYOAI
  turns skip the gauge (`agent_turn_preflight.go:87`).
- **Per-IP fairness** — `PublicRateGuard` already caps `/agent/turn` at 120/min per IP
  (`ratelimit.go:36,51`). No new counter.

### The one real gap → the one addition: an owner-written cron that auto-refills the gas tank

Gas is a **manual** pool today — nothing resets it (`provider_gas.go:1-7`), so a daily free tier
can't be expressed. The reset primitive already exists (bumping `gas_filled_at` re-opens the tank —
`owner_providers.sql.go:238`) and the periodic-job mechanism already exists (`periodic.Named`,
`wire/periodic.go:34`). Add:

1. **`owner_providers.gas_refill_cron text` (nullable)** — empty/null = manual pool (today's
   behaviour, unchanged); a **cron expression the owner writes** = auto-refill on that schedule.
   Set via `providers_update` (three-state, like `gas_tokens`), **validated at input** (a malformed
   expression is rejected with a clear error — normalize once at the boundary, not at every read).
   Standard 5-field cron plus `@daily`/`@hourly`/`@weekly` descriptors. A cron aligns the refill to
   the provider's real reset boundary (e.g. `0 0 * * *` when the free tier resets at 00:00) — better
   than a rolling interval, which drifts off the provider's calendar reset. Evaluated in **UTC** by
   default (matches most provider resets; owner-timezone is a later option).
2. **One checker job** — a fixed short-interval `periodic.Named("gas refill", ~1m, fn)` slotting
   into `collectPeriodicJobs` (`wire/periodic.go`). For each provider that has a cron, if a
   scheduled tick has passed since `gas_filled_at` (`schedule.Next(gas_filled_at) <= now`), it bumps
   `gas_filled_at = now()`, re-opening the budget. Refill lag is bounded by the checker interval
   (~1 min after the cron boundary). Reuses `ProviderRemaining` entirely.

Cron parsing needs a real parser (edge cases make hand-rolling unsafe) and no cron lib is vendored
today, so this adds one justified dependency: `robfig/cron/v3` (the standard Go choice — parse +
`Schedule.Next`). Nothing else new.

This is a **general** extension of the gas tank (any provider, any schedule), not a Groq feature.
The whole public free tier is then: public role `GasMetered=true` + free provider with
`gas_tokens=<budget>` and `gas_refill_cron=<owner's schedule>` (e.g. `0 0 * * *`).

### The one real frontend gap: wire the exhaustion CTA

The backend already returns `403 {Code:"gas_exhausted"}`, but the app swallows it into a generic
error string (`use-chat.ts:348-350`); the `exhausted` gate is turn-count only and dead for public
(`session-store.ts:85`, public `max=0`). Add: the public chat switches on the `gas_exhausted` code
(and `period_limit_reached`) and shows a **get-a-code / BYOAI** CTA, reusing the existing
`BYOAIPanel` + `useGate` + `/gate` affordances (`ReaderChatRail.tsx:34-35`). Human-readable, no raw
error.

### Provider-compat fixes (reproduced via `make eval-ask` against Groq, 2026-09-23)

Running the real agent loop against Groq surfaced two concrete interop bugs. The free tier itself
works — a full grounded turn (system 9909 tok + a `corpus_search` round-trip returning 5458 tok)
produced a complete, high-quality answer — but both of these must be fixed for Groq (and any strict
OpenAI-compatible endpoint):

1. **Endpoint needs `/v1`.** The eino OpenAI-compat client appends only `/chat/completions`, so the
   Groq preset `base_url` (`https://api.groq.com/openai`) yields `POST /openai/chat/completions` →
   404. Fix the `groq` preset base_url to `https://api.groq.com/openai/v1` (DeepSeek works without
   `/v1` because it accepts `/chat/completions` at root; Groq does not). One-line preset fix.
2. **Strip `reasoning_content` on the request.** Reasoning models (Groq `gpt-oss-*`) return a
   `reasoning_content` field; echoing it back on the next turn's assistant message makes Groq 400
   (`property 'reasoning_content' is unsupported`). Add a guard that drops `reasoning_content` from
   outgoing assistant messages, analogous to the existing `contentGuardModel` (which forces
   non-empty `content` for DeepSeek). Today the turn only survives via the force-final fallback —
   do not rely on that.

Available Groq chat models as of test: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
`qwen/qwen3.8-27b` (the `llama-3.3-*` line is gone).

### Optional backstop: classify upstream 429

Secondary. With a gas budget we self-limit before the provider's own limit, so the provider's 429 is
rare. But today a live 429 that survives retries becomes a generic **500** (`errors.go:18,68`
sentinels exist but nothing produces them; `eino_model.go:142` wraps opaquely). Map upstream `429`
→ `ErrRateLimited` so a mid-day provider hiccup surfaces as a clean `429 rate_limited` (same CTA),
not a 500. Include if cheap; not required for the core feature.

## Principles honoured

- Reuse first: routing (public role), budget + enforcement (gas), exhaustion 403, per-IP rate, and
  the 24h periodic-job slot are all existing. The only new primitive is a general gas auto-refill.
- Rule #1: we set and reset OUR own daily budget (gas) on OUR schedule; we do not mirror the
  provider's live remaining quota. The provider 429 is only a backstop.
- Rule #10: exhaustion has an escape hatch — code or BYOAI.
- Not vendor-specific: the public provider is any provider row; the gas period is general.

## Non-goals / future

- Paid fallback provider (rejected by the locked decision).
- Multiple free keys/providers rotated to multiply the pool.

## Test matrix (build test-first, e2e/blackbox — drive user actions, assert visible markers)

Use the mock LLM stack as the public provider.

1. Public role `GasMetered=true` + free provider `gas_tokens=N`: anonymous public turns are served
   and metered against that provider; owner/coded turns use the default provider (no leak).
2. When cumulative public spend reaches the tank, the next public turn is refused with
   `403 {Code:"gas_exhausted"}` (this already works — the guard proves the config path).
3. The app renders the get-a-code / BYOAI CTA on `gas_exhausted` (assert visible CTA + BYOAI panel
   and request-access reachable). RED on current code (which shows a generic error).
4. Auto-refill: with a `gas_refill_cron` whose tick has passed since `gas_filled_at`, after the tank
   is exhausted and the checker job runs, a public turn is served again — the budget re-opened. RED
   on current code (no refill job exists). Include a `@daily`-descriptor case.
5. Empty `gas_refill_cron` keeps today's behaviour: a manual tank never auto-refills. A malformed
   cron is rejected at `providers_update` with a clear error and is not stored.
6. BYOAI still overrides: a BYOAI turn uses the visitor key, bypasses the public gas gauge, and is
   not billed.
7. Migration: existing volume upgrades cleanly; `gas_refill_cron` defaults null (every current
   provider stays a manual pool).
8. (If included) A mock upstream 429 surfaces as a clean `429 rate_limited` with the same CTA, not a
   500.

## Open sub-decisions (recommendations)

- Free provider + model: owner's choice on the provider row (Groq + a strong free model first;
  confirm via `providers.list_models`).
- Budget size (`gas_tokens`) and refill schedule (`gas_refill_cron`, e.g. `0 0 * * *` for a daily
  reset at 00:00 UTC): owner sets to fit the provider's free tier.
