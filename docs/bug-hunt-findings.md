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

## Fixed (TOCTOU / dead-code / lifecycle — reproduced at the deterministic level each allowed)

These needed a fix to become deterministically testable (a flaky concurrency test would violate
`no-rerun-on-flake`); each fix ships with a deterministic test.

| # | Sev | Fix | Test |
|---|-----|-----|------|
| 2 | HIGH | `CreateCodeBooking` is now an atomic conditional insert: `FOR UPDATE` on the code row serializes concurrent bookings and the insert only happens when the count is under the code's `max_bookings` → 0 rows = `ErrBookingQuotaExhausted`. Enforcement moved from the advisory assembly-time hide to the DB. | `dbq/code_bookings_quota_test.go` (query carries the FOR UPDATE + cap guard) |
| 6 | MED | Claim-before-send: `MarkBookingConfirmed` is a `:execrows` CAS (`WHERE confirmation_sent_at IS NULL`) run BEFORE the email; a lost claim → `ErrBookingConfirmationSent` (no send); a send failure releases the claim (`ClearBookingConfirmed`) so a retry can re-send. `Owners` narrowed to an interface for testability. | `usecases/booking_confirmation_race_test.go` (two deliveries → one email) |
| 7 | MED | `QueryQueue` wired into `runAgentTurn` via `acquireTurnSlot` (per-session single-flight + global cap), released on turn end. | `routes/public/agent_turn_queue_test.go` (single-flight enforced; nil queue no-op) |
| 8 | MED | Revoke missed long-lived active sessions: the code→sessions index set's TTL was set only at issue while the token key's TTL slid on every access, so a session active past 60m fell out of the index and `DeleteByCode` couldn't find it. `persist` now re-indexes on every write, so the index slides with the session. | `session/visitor_session_revoke_test.go` (miniredis FastForward past the TTL → revoke still kills it) |
| 13 | MED | The final PDF is rendered BEFORE the irreversible commit (application id pre-generated; draft read read-only), so a render failure persists nothing and the owner can retry. `Apps` narrowed to `CommitStore`. | `plugins/jobs/jobsuc/applications_commit_test.go` (render fail → Commit not reached) |
| 14 | LOW | `Sweep` re-stats each dir immediately before `RemoveAll`; a workspace freshened between the List snapshot and removal is kept. | `sandboxws/sweep_toctou_test.go` (a revived dir is not swept) |
