# Active goal (2026-09-06) — three big specs, then release

Owner goal (blocks Stop until met). All test-first; then release + deploy to sijie + self-verify live.

## Spec 1 — coded-landing test scenarios, exhaustive
Fill EVERY coded-visitor landing scenario with tests (enumerate the whole state space). States at `/`
(+ `?code=`):
- valid code, fresh visitor → picker → name → **can converse**. DONE (coded-visitor-can-converse).
- valid code, returning (session for the same code) → lands on that chat.
- **invalid code → a real landing** (not "under construction", not silently the old chat). DONE →
  redirects to /gate.
- **a new code while in a session for a different code → switch to it** (opening HIRING-2026xxxx while
  in HIRING-2026 must not stay in the old chat). DONE (chooseVisitorView pending-wins + UT).
- first-paint race (hasCode before the client absorbs the code) → picker, never a HomeFallback flash.
  DONE (visitor-root.test.ts — the race is unit-tested, so it reproduces deterministically).
- codeless, no live home → the default homepage (NOT "under construction"). TODO (home-fallback).
- ?q= codeless question → /gate handoff.
Rule: assert the CAPABILITY (can start a conversation), never an absence. A race condition → a unit
test that makes an intermittent failure deterministic.

## Spec 1b — per-code landing slug (owner idea)
Each access code gets its OWN path slug (the code "carries its own handle", but the handle is not the
raw code).
- New field `access_codes.slug` — NOT the raw code (so the code isn't exposed), and a real path (so it
  avoids the bare-`/` homepage conflict we kept patching). Non-empty, unique (per owner). The owner
  may set it (e.g. `hire_me`); **if unset, default it from a SNOWFLAKE id, base62-encoded to a short
  slug** — snowflakes are globally unique + time-ordered with no central coordination, so a future
  multi-tenant / distributed cloud product needs no shared sequence. (Named `slug`, not `handle`, to
  avoid colliding with owner.handle — [[vocabulary-must-not-diverge]].)
- Landing: `?code=HIRING-2026` → the client absorbs the code → rewrites the URL to `/<slug>` (e.g.
  `/hire_me`), a dedicated path per code. This supersedes stripping to bare `/`.
- Isolation: arriving at `/<slug>`, the client checks the cookie for a code bound to that slug →
  resumes / locates that conversation, isolated per slug (different conversations locate immediately).
- Tests first: slug non-empty + unique (backend); `?code=` → `/<slug>` landing → the right
  conversation; per-slug isolation. Needs a MIGRATION (new column) + an upgrade-path test
  ([[schema-lives-in-the-volume-not-the-image]]).

## Spec 2 — resume composer: real drag layout
- **Real drag** — done for row reorder (P3-b, pointer capture, artifact-asserted). Extend to ALL
  blocks: the owner reorders every section by dragging, not just rows within a section.
- **Font size selectable** (like the accent colour — a control, persisted in resume_content, read by
  the template).
- **Drag-to-lay-out**, including **block size** (blocks resizable).
- Editing content stays in the LEFT panel; the canvas is drag. No pencils (done).
- Test-first, assert the artifact (committed PDF / preview geometry).

## Spec 3 — CorpusWidget query language (QL)
DONE. `path:<subtree> sort:recent|title limit:<n>` (parseCorpusQuery / applyCorpusQuery in
@standmeet/sdk-core; `<CorpusWidget query=... />`). UT: corpus-query.test.ts, 7/7. Follow-up:
genre/tag/date filters need those fields on CorpusCard.

## Queued (security, later — owner flagged)
- **Email-bomb protection.** Audit every outbound-mail path (booking confirmation, access-request
  approval mail, owner notifications, the mail connector) for rate-limiting / anti-abuse: can an
  attacker trigger mass emails to a victim (or exhaust the owner's mail quota) by repeating a public
  action? Add per-recipient / per-action throttles + tests where missing. "安全不可小觑."

## Then
Release (PATCH bump from v0.1.23), deploy to sijie (coolify-sijie-deploy-sop), rebuild sijie's home
microsite (flex-col + limit + the composer/widget changes), self-verify live.

## Committed this session (goal-related)
Composer visual designer → v0.1.23. Post-release: pencil removal (canvas = drag + left-panel edit),
moveTo/reorderRowByIndex, education row-anchors, dropTargetIndex (nearest, excludes source),
canvas-drag spec (exp up/down/3-row/edu, 4/4), coded-landing flash + switch + invalid→/gate + UT +
coded-visitor-can-converse, CorpusWidget QL + limit. Remaining: Spec 1b (code slug), Spec 2 (font size
+ all-block drag + block size), home-fallback → default, then release.
