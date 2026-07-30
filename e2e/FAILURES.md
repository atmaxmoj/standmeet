# Full-suite failures — run 20260730T011543Z

`make test`: **1134 passed, 10 failed** (1.0h). Artifacts:
`e2e/test-results-archive/20260730T011543Z/` (10 case dirs + `backend.log`).

Context: this is one long refactor (dissolving the three by-layer god-packages + `internal/plugins`,
then externalizing booker). The suite was green before it started, so **every red here is refactor
fallout and none is exempt.**

---

## Batch A — spec-side rot: the refactor renamed a table, specs still use the old name

**Proven cause** (identical stderr in both `error-context.md` files):

```
ERROR:  relation "owner_calendar_connectors" does not exist
```

`backend/db/schema.sql` now has `owner_connectors` (line 764) and `owner_mail_connectors` (727);
`owner_calendar_connectors` is gone — the connector refactor generalised the per-category table.
Both specs `docker exec psql UPDATE owner_calendar_connectors ...` to force a token expiry, so they
die in setup before asserting anything.

| # | spec | test |
|---|---|---|
| A1 | `connector-dep-drop-mid-turn.spec.ts` | tool exposed at assembly but connection drops before the book call → no 500, no leak |
| A2 | `connector-revoked-degrades.spec.ts` | refresh hits invalid_grant → friendly error, never a 500 |

**Fix:** point both at the current table/columns. Verify the column names on `owner_connectors`
first (`access_token_expires_at`? how is `provider = 'google'` expressed now the table is
category-generic?) — do not assume they carried over unchanged.

---

## Batch B — copy changed, assertion did not

**Proven cause** (the locator resolved 11× to the same text):

- expected: `/no supported auth|不支持的认证|无可用认证/i`
- received: `"this spec declares no authentication — if the API needs a key, pick one below"`

| # | spec | test |
|---|---|---|
| B1 | `connector-cred-form.spec.ts` | spec with no securityScheme → friendly "no supported auth" message |

**Settle before editing:** which side is right? The received copy is friendlier and actionable,
which reads like a deliberate improvement, but I have not proven whether the refactor changed it
deliberately or incidentally — check the string's history first. The test's *intent* (a friendly,
non-technical message when a spec declares no auth) must survive either way.

---

## Batch C — my change: booker is no longer `visitor_only`

**Proven cause** (golden diff shows exactly one object removed):

```
-     "id": "calendar.book",
-     "origin": "builtin",
-     "shape": "visitor_only",
```

I set the booker manifest to `ShapeBoth` so it can serve owner tools (`calendar.list_slots`) from
the sandbox. The spec filters `c.shape === 'visitor_only'`, so `calendar.book` drops out.

| # | spec | test |
|---|---|---|
| C1 | `norm-inward-capabilities.spec.ts` | inward(visitor_only) 能力的 id + origin + 顺序逐字等于 golden |

**Fix direction:** the snapshot's subject is *visitor-facing* capabilities, and booker still is one.
The filter should be "not owner-only" — matching `capreg.VisitorCapabilityIDs`, the only Shape
filter in the backend (`Shape() != ShapeOwnerOnly`) — with the golden recording `shape: 'both'`.
Narrowing the golden instead would silently drop booking from the snapshot.

---

## Batch D — sandbox dial cancelled → the capability is silently HIDDEN

**Proven cause** — archived `backend.log` carries 21 of these, each immediately followed by the
capability being dropped from the session:

```
msg: "visitor capability failed to bind — hidden from this session"
err: "plugin dial: mcp server unreachable: stdio initialize: transport error: context canceled"
```

counts: `corpus.retrieval` ×8, `ask_visitor` ×6, `summarize_conversation` ×6, `calendar.book` ×1.

Two facts pin the mechanism:

1. `mcpclient.dialTimeout` is **20s**; exceeding it yields `context deadline exceeded`. The log says
   **`context canceled`**, which in Go means the **parent** context was cancelled — the inbound HTTP
   request ended before the dial finished and its cancellation propagated in.
2. The caller budgets match: `subjectivity-genre` fails with
   `apiRequestContext.post: Timeout 10000ms exceeded` on `POST …/tools/corpus_read`. The client gives
   up at 10s, cancelling the request, which cancels the in-flight sandbox dial.

So a cold spawn is outlasting the caller's budget (>10s, <20s), and on that failure the capability is
**hidden rather than reported** — the F-A-1 shape again: infra failure presenting as "this capability
does not exist", which downstream reads as missing data.

| # | spec | observable | consistent with |
|---|---|---|---|
| D1 | `tool-endpoint-calendar-book.spec.ts` | `capability_state.quota_remaining` expected 1, got `undefined` | `calendar.book` hidden → absent from `capability_state` |
| D2 | `tool-endpoint-calendar-book.spec.ts` | expected 404, got 200 (quota cascade) | first book never burned quota because the cap was hidden |
| D3 | `tool-endpoint-state-cascade.spec.ts` | `quota_remaining` expected 1, got `undefined` | same as D1 |
| D4 | `subjectivity-genre.spec.ts` | `POST /tools/corpus_read` timeout 10s | `corpus.retrieval` dial cancelled (×8 in log) |
| D5 | `booking-owner-notify.spec.ts` | no Mailpit mail within 10s | booking never completed → no owner notify |
| D6 | `connector-retry-async-owner-notify-nonblocking.spec.ts` | test timeout 30s | same booking path |

**NOT proven, must not be assumed:** *why* a cold spawn exceeds 10s in this run, and whether D5/D6
share this cause or only the symptom. Per SOP step 4 this is the "logs insufficient → add logging"
case: instrument the dial with spawn duration and which phase (bwrap exec vs MCP initialize), then
re-capture and read — not guess "load".

This batch is a **product** defect as much as a test one: a capability that vanishes because its
sandbox was slow is fail-silent. The fix likely has two parts — make the spawn fast/warm enough, and
make an infra failure legible instead of invisible.

---

## Order

A → B → C → D. A/B/C have proven, self-contained causes; D needs a measurement pass first.
A batch is done **only** when `make test-only SPEC="<batch specs>" REPEAT=5` is all-green.
Full-suite re-run only after every batch is repeat-5 green.
