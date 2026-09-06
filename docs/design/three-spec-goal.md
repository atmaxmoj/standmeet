# Active goal (2026-09-06) — three big specs, then release

Owner goal (blocks Stop until met). All THREE test-first; then release + deploy to sijie + self-verify live.

## Spec 1 — coded-landing test scenarios, exhaustive (举一反三 / 穷举)
Fill ALL coded-visitor landing scenarios with tests. Enumerated states at `/` (+ `?code=`):
- valid code, fresh visitor → picker → name → **can converse** (positive assertion, not "not X"). ✓ coded-visitor-can-converse
- valid code, returning (session for same code) → lands on that chat. 
- **invalid code → a proper landing page** (not "under construction", not silently the old chat). TODO fix + test.
- **new code while in a session for a different code → switch to the new one** (owner: HIRING-2026 then HIRING-2026xxxx stayed in the old chat). TODO fix + test.
- first-paint race (hasCode before absorb) → picker, never HomeFallback flash. ✓ visitor-root.test.ts (UT, race made 必现)
- codeless, no live home → default homepage (NOT "under construction"). TODO (home-fallback → default).
- ?q= codeless question → /gate handoff.
Rule: assert the CAPABILITY (can start a conversation), never absence. Race conditions → UT to make 偶现 into 必现.

## Spec 2 — resume composer: real drag layout
- **Real drag** (done for row reorder: P3-b, pointer capture, artifact-asserted). Keep/extend.
- **Font size selectable** (like accent colour — a control, persisted in resume_content, read by template).
- **Drag-to-lay-out**, including **block size** (owner arranges the résumé by dragging; blocks resizable).
- Editing content stays in the LEFT panel; the canvas is drag. No pencils (done).
- Test-first, assert the artifact (committed PDF / preview geometry).

## Spec 3 — CorpusWidget query language (QL)
- CorpusWidget supports its own QL: pick a subtree, filter, sort, limit. (Has `limit` today; default home now uses limit={6}.)
- Test-first: the QL selects/filters/sorts the right entries into the widget.

## Then
Release (PATCH bump from v0.1.23 → v0.1.24…), deploy to sijie (coolify-sijie-deploy-sop), rebuild sijie's
home microsite (flex-col + limit + whatever composer/widget changes), self-verify live.

## In-flight batch to commit first (already built + mostly green)
Pencil removal (canvas = drag + left-panel edit), moveTo/reorderRowByIndex, education row-anchors,
dropTargetIndex (nearest, excludes source), comprehensive canvas-drag spec (exp up/down/3-row/edu),
coded-landing flash fix (chooseVisitorView + page.tsx hasCode + UT), coded-visitor-can-converse spec,
CorpusWidget limit on default home.
