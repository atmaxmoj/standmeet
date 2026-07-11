# Systematic bug-hunt — findings & reproduction status

A 6-agent adversarial hunt (2026-07) over the blind spots that green-on-mock e2e misses:
prod-vs-dev config forks, zero-coverage paths, security REJECT branches (allow-lists bypass them),
error/failure shapes mocks don't produce, and TOCTOU/concurrency. Each finding below was confirmed
against the code.

**Reproduction discipline:** every defect gets a **failing (RED) test at the largest granularity
that reaches it** — e2e through the real stack where possible, dropping to a pure-logic Go test only
where the bug is a pure helper or is otherwise unreachable end-to-end. A handful are genuine
TOCTOU/concurrency or dead-code/config bugs whose only faithful reproduction is a racy concurrency
test; per the repo's `no-rerun-on-flake` rule we do **not** ship flaky tests — those are documented
here with the confirmation evidence and the fix, to be covered by a deterministic test as part of
the fix.

D1/D3/D4 (earlier static-defect pass) are already fixed+committed (`88c1ed5`) and are not repeated
here.

## Reproduced (RED test written, fails against current code)

| # | Sev | Defect | Repro test | Level |
|---|-----|--------|-----------|-------|
| 1 | HIGH | Unauthenticated SSRF: `POST /api/v1/inference/models` dials any caller endpoint (no egress guard) | `e2e/test/security-inference-models-ssrf.spec.ts` | e2e |
| 3 | HIGH | Booking orphans a real calendar event when the DB row fails to persist (no `DeleteEvent` compensation) | `backend/internal/usecases/calendar_book_repro_test.go` | unit (e2e can't fault-inject the internal DB write) |
| 4 | MED-HIGH | BYOAI `X-Byoai-Endpoint` SSRF: eino client dials internal (no egress guard) | `e2e/test/security-byoai-endpoint-ssrf.spec.ts` | e2e |
| 5 | MED | Report HTML (model output) embedded verbatim into network-enabled Gotenberg Chromium → SSRF | `e2e/test/security-report-html-injection.spec.ts` | e2e |
| 9 | MED | Duplicate note titles silently collapse in Obsidian reconcile (oldest-any-genre claim, no uniqueness) | `e2e/test/sync-duplicate-title-collapse.spec.ts` | e2e |
| 10 | MED | Job-fetch `readOK` / gunzip do unbounded `io.ReadAll` → memory DoS / gzip bomb | `backend/internal/plugins/jobs/fetch/fetch_repro_test.go` | unit (pure helper) |
| 11 | MED | `UpdateNoteSEO` omits `owner_id` → multi-tenant BOLA | `backend/internal/postgres/dbq/corpus_notes_seo_bola_test.go` | unit (single-owner v1 → unreachable e2e; query-level) |
| 12 | LOW | `hnFirstLine` truncates on **bytes** not runes → invalid UTF-8 titles | `backend/internal/plugins/jobs/fetch/fetch_repro_test.go` | unit (pure helper) |
| 15 | MED | owner-CSS sanitizer bypasses: protocol-relative `url(//host)` not stripped; `@media` inner selectors not scoped | `e2e/test/owner-css-bypass.spec.ts` | e2e |

## Confirmed, no deterministic test yet (TOCTOU / dead-code / missing fault-infra)

| # | Sev | Defect | Confirmation | Fix direction |
|---|-----|--------|-------------|---------------|
| 2 | HIGH | `max_bookings` quota enforced only at capability **assembly** (`capreg_booker.go bookerQuotaExhausted`), never re-checked at commit → two concurrent turns both pass the gate at count=0 and both book | Read: `commitBooking` never consults `CountBookingsForCode`; sequential turns are correctly blocked (re-assembly), only concurrent bypasses → racy | Enforce quota atomically at commit: transactional recount or a `(code_id)` count constraint / `SELECT … FOR UPDATE` |
| 6 | MED | Booking-confirmation double-send: `deliverConfirmation` reads `ConfirmationSentAt==nil` → sends → marks (non-atomic); two concurrent POSTs both send | Sequential idempotency is already green (`connector-err-confirmation-idempotent.spec.ts`); the concurrent race is the gap. `deliverConfirmation` depends on the concrete `*postgres.OwnerRepo` (no unit seam) | Make the mark a conditional CAS (`UPDATE … WHERE confirmation_sent_at IS NULL`), claim-before-send |
| 7 | MED | Query-queue concurrency cap is **dead code**: `QueryQueue.Acquire/Release` have zero call sites outside `query_queue.go`; constructed at `repos.go:183`, stored, never consulted on the turn path | grep: no `.Acquire`/`.Release` on the agent-turn path; `QUERY_QUEUE_MAX_CONCURRENT` has no effect | Wire `Acquire`/`Release` around the visitor agent-turn; add a concurrency test alongside the fix |
| 13 | MED | `CommitApplication` runs the DB tx (issue code, write application, delete draft) **then** renders the PDF; a render failure strands a committed application with no PDF and no retry (`ErrResumeDraftNotFound`) | Read `applications.go`: `prepareCommit` (tx) precedes `Renderer.RenderApplicationPDF`; unit needs a DB, e2e needs a Gotenberg fault hook the harness lacks | Render before the destructive commit, or make commit idempotent/retryable so the PDF can be regenerated |
| 14 | LOW | Sandbox `Sweep` reads `List()` (mtime snapshot) then `RemoveAll` per dir with no re-check; a workspace revived between snapshot and removal is wiped | Read `sandboxws/manager.go`: no mtime re-check immediately before `RemoveAll`; no interleave seam for a deterministic test | Re-stat each dir immediately before `RemoveAll` and skip if freshened |
