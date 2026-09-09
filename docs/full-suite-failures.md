# Full-suite failures — round 2026-09-08 (branch `worktree-traffic-analytics`, rebased on `origin/main` 36789537d)

**1722 passed · 22 failed · 6 skipped · 1.1h.**

- Suite log (numbered failure blocks 1–22 at the end): `scratchpad/gate2.log`
- Failure artifacts: `e2e/test-results-archive/20260908T041849Z/` (per-test `error-context.md` with page snapshots)
- Backend log: `e2e/test-results/backend.log`

Diagnose from the archive. Do not re-run to diagnose, do not bare-docker.

**No pre-existing exemption.** Several batches below were caused by deliberate main-side design
changes, not by this branch. That is an explanation, not an excuse — every red goes green.

## What the previous round already fixed

Run 1 of this suite had 7 reds by test #44 from ONE root cause of this branch's own making: the
per-checkout port work swept compose `ports:` lists and missed every **host-visible URL**. Fixed in
18 places (`GOOGLE_AUTH_URL`, `e2e/fixtures/admin.ts` public_url, 9 specs calling `localhost:8000`,
3 connector `authorizationUrl`, 5 `owners.public_url` writers) plus a gate. Those 7 are green here.
Batch A below is the same class surviving in a spelling the gate cannot see.

---

## Batch A — a knob default written into an ASSERTION, where the gate cannot see it | 2

| # | spec | error (from log) |
|---|------|------------------|
| 21 | `writings.spec.ts:143` | `toMatch` expected `/localhost(%3A\|:)9200/`, received `http://localhost:9600/standmeet/…` |
| 22 | `writings.spec.ts:187` | same |

**Root cause (proven)**: 9200 is `DEV_PORT_MINIO`'s DEFAULT; this checkout publishes minio on 9600.
The presigned URL is correct — `STORAGE_PUBLIC_URL` was fixed last round to follow the knob. The
spec asserts the default port instead of this checkout's.

The interesting half: `check-no-hardcoded-dev-stack.sh` was extended last round to catch exactly
this, and it did NOT catch these two. Its pattern is `localhost:(9200|…)`; the spec writes a REGEX,
`localhost(%3A|:)9200`, so the literal `localhost:9200` never appears. The gate is blind to the
escaped/alternated spelling — a verifier that reports a clean tree while the defect is in it
([[verifier-can-lie-about-its-own-coverage]]).

**Fix**: assert against the storage origin this checkout publishes (derive from
`process.env['STORAGE_PUBLIC_URL']` / the minio knob, the way `e2e/fixtures/stack.ts` does), and
widen the gate's pattern so `localhost` followed by a separator-alternation and a knob default also
goes red. Prove the widened gate red on these two lines before fixing them.

**Status: not started.**

---

## Batch B — the starter homepage is no longer materialized at claim | 4

| # | spec | error (from log) |
|---|------|------------------|
| 4 | `coded-ask-continues.spec.ts:50` | `the default homepage auto-goes-live` — expected 200, received 404 |
| 10 | `microsites-linked-on-public-surfaces.spec.ts:92` | same |
| 15 | `public-ask-gates.spec.ts:33` | same |
| 11 | `monitor-microsite-tracker.spec.ts:46` | `start home build` — `POST /home/build` expected 200, received 404 |

**Root cause (proven)**: `185c4321b` — *"Q1 part 2: stop materializing the starter home at claim —
serve DefaultHome from code"* (on `origin/main`, NOT this branch). `backend/cmd/server/boot_http.go:275`
now passes `InstallHomepage: nil`, with the comment *"Homepage is NOT materialized at claim now: an
unedited instance serves DefaultHome"*. `InstallDefaultHomepage` is still exported through
`owner/facade/facade_usecase.go:77` and has **no remaining caller**. So there is no `home`
microsite row on a fresh instance: `/home/build` 404s and nothing ever goes live.

The four specs all assume the old shape (a `home` row exists, can be built, and auto-promotes).

**Fix (owner-decided, 2026-09-08): the specs SEED a homepage.** Not "assert against DefaultHome",
not "put the claim-time install back" — a spec that needs a homepage creates one, the way an owner
does. One shared helper for all four (they already share the auto-goes-live poll), so the seed
happens in one place and #11 exercises the shipped template through it too.

**Status: not started.**

---

## Batch C — a code now lands on `/c/<slug>`, the specs still wait for `**/` | 5

| # | spec | error (from log) |
|---|------|------------------|
| 3 | `code-session-paste.spec.ts:33` | `waitForURL` timeout waiting `**/`; navigated to `/c/6HaQXYnnck` |
| 6 | `gate-access.spec.ts:38` | same; `/c/6HbRkns5gY` |
| 7 | `gate-code-ux.spec.ts:95` | same; `/c/6HbSviEV4A` |
| 8 | `gate-code-ux.spec.ts:102` | same; `/c/6HbTxyOGM8` |
| 9 | `gate-code-ux.spec.ts:117` | same; `/c/6HbUAEDs9q` |

**Root cause (proven)**: `c6c54ce88` *"feat(access): code carries its own /c/<slug> landing path"*
(2026-09-06, an ANCESTOR of this branch's start `6ed1759bb` — so it is main's, and predates this
work entirely). Redeeming a code lands the visitor on `/c/<slug>`, not on the site root. Five specs
still `waitForURL('**/')`.

The contract is already settled and unit-tested — `app/src/lib/visitor/code-landing.ts:27` +
`code-landing.test.ts`: a code with a **microsite** goes to the microsite; otherwise a code with a
**slug** SOFT-rewrites to `/c/<slug>`; a code with neither does nothing. No design question here.

**Fix**: wait for the landing path the product now uses. Do NOT relax the glob to something that
also matches the root — that would pass whether or not the landing works. The tests that then go on
to assert chat/strip/name behaviour keep those assertions unchanged.

**Status: not started.**

---

## Batch D — global SEO settings were removed; three guards still call them | 3

| # | spec | error (from log) |
|---|------|------------------|
| 12 | `norm-outward-tools-coverage.spec.ts:104` | `tool 'seo.update_settings' not found` |
| 14 | `owner-mcp-parity-reads.spec.ts:181` | `tool 'seo.get_settings' not found` |
| 13 | `norm-outward-toolset.spec.ts:245` | `tools/list` golden: −3 / +6 |

**Root cause (proven)**: `7037a434e` *"refactor(seo): remove the global SEO settings feature (SEO
follows each microsite)"*. The owner confirmed the intent directly: **SEO belongs on the homepage
microsite**, set through `microsite.set_seo` / `seo.set_entry_seo`. The three global tools
(`seo.get_settings`, `seo.stats`, `seo.update_settings`) are gone by design.

The golden (#13) is stale in both directions — it lost those 3 and has not gained 6:
`appearance.set_favicon`, `codes.rotate`, `microsite.rename`, `microsite.set_seo` (all main's) and
**`monitor.events`, `monitor.stats` (this branch's)**.

**Fix**: #12/#14 exercise SEO through the microsite path instead of the removed global tools.
#13 regenerates the golden — and the two monitor tools must be in it, which is this branch's
obligation, not drift.

**Status: DONE (2026-09-08).** `make test-only REPEAT=5` green on all three (15 / 25 / 40 passed).

- #12 → `microsite.set_seo`, then read back through `microsite.list`: a receipt that echoes its own
  request proves nothing, so the read-back is the half that carries the information.
- #14 → `microsite.list` reads back SEO seeded in `setup`. `seo.stats`' other half (published
  wiki / output / writing counts) has **no successor tool** on the microsite path and is not
  re-checked; recorded here rather than dropped silently.
- #13 → golden is now 157 names, **derived, not guessed**: every `fp.OwnerAction()`/`fp.OwnerRead()`
  op declared in `backend/` (132 of them) was scanned and diffed against the list. The diff was
  exactly −3 / +6, matching this row. Removed `seo.get_settings`, `seo.stats`,
  `seo.update_settings`; added `appearance.set_favicon`, `codes.rotate`, `microsite.rename`,
  `microsite.set_seo`, `monitor.events`, `monitor.stats`. The stale hand-written **count** in the
  header (143, while the list held 154) is gone — a number nobody can check from the list below it
  is a second fact with its own drift.

Red was sealed by mechanism, not experiment: this checkout had 0 containers (`make test-red`
refuses without a running stack), and `grep 'ID: "seo\.'` over `backend/` returns only
`seo.set_entry_seo` — a dispatcher can only serve a declared op, which is the archived
`tool 'seo.…' not found` verbatim.

---

## Batch E — assertions that cannot hold, one cause each | 8

Grouped because each needs its own attribution, not because they share a cause. Every one still
gets fixed.

| # | spec | error (from log) | what is known |
|---|------|------------------|---------------|
| 2 | `admin-sidebar.spec.ts:85` | `toHaveText` expected `6m 46s`, received `6m 50s` | **ROOT CAUSE PROVEN.** Reads the footer on /admin/dashboard, navigates to /admin/system, compares character-for-character. Both render `deployView(info).uptime` from one store (`AdminSidebar.tsx:179`, `SystemSection.tsx:60`) — already single-source — but the store refetches between the two reads, so it compares two moments of a running clock. Fix: read BOTH testids on ONE screen (the footer is on every admin page) in a single `page.evaluate`, keeping character-exact. UT `app/src/lib/admin/system-uptime-single-source.test.ts` written and proven RED (planted `uptime:'0s'`). |
| 1 | `admin-nav-skeleton.spec.ts:26` | `route.continue: Route is already handled!` | **TEST-WRONG (teardown race), fixed.** See below. |
| 5 | `connector-err-midstream-sse-cut.spec.ts:111` | `cut happened before the turn finished streaming` (`event: done` present) | The tool call SUCCEEDED (`calendar_book` → `ok:true`), so connector wiring is fine. The cut lands after the turn completes — the harness races the stream. |
| 16 | `reader-expired-session.spec.ts:37` | `locator('body')` expected visible, received **hidden** | **TEST-WRONG (preamble describes a shape the product left behind), fixed.** See below. |
| 17 | `real-third-party-mcp-network.spec.ts:68` | `chatroom` `toContainText` — expected 1 substring, received 42 chars | **PRODUCT-WRONG — inconsistent vendored plugin bundle, fixed.** See below. |
| 18 | `sources-page-does-not-promise-a-scan.spec.ts:43` | expected substring `jobs.fetch_new`; page says "Where the loop pulls listings from…" | **OWNER-DECIDED (2026-09-08): the owner-facing sources page does NOT name the MCP call.** So the GUARD is the wrong half, not the copy. Keep the half that holds — the page must not promise an automatic scan — and drop the requirement that it name `jobs.fetch_new`. Do not weaken the remaining half into something unfalsifiable: it must still go red on copy that implies listings arrive by themselves. |
| 19 | `visitor-chat-throbber-reading-dom.spec.ts:65` | `[data-testid="tool-throbber-corpus_read"]` not found | **PRODUCT-WRONG — this branch's own regression: the visitor's SSE no longer streams.** See below. |
| 20 | `visitor-multi-conversation.spec.ts:79` | `floating-chat-input` expected disabled, received enabled | Turn budget shared across a member's conversations — the budget did not bite. |

**Status: #1 / #16 / #17 / #19 DONE (2026-09-08). #2 / #5 / #18 / #20 not started.**

### #17 — the fetch plugin died at import, so the capability never existed

`infra/plugins/provision.sh` installed `mcp-server-fetch==2026.6.4`, whose metadata declares
`mcp>=1.1.3` with **no upper bound**. pip therefore resolved `mcp` 2.x, which renamed
`McpError` → `MCPError` — the exact name `mcp_server_fetch/server.py` imports. The bundle
installed clean and died on the first line of the module:

```
ImportError: cannot import name 'McpError' from 'mcp.shared.exceptions'. Did you mean: 'MCPError'?
```

Both `netfetch` and `cagedfetch` read that one bundle, so **both** capabilities failed to bind.
The `:90` case ("egress denied") was green for the wrong reason: the tool did not exist at all,
so of course nothing was fetched.

Three defects, all fixed:

1. **The bundle.** Bumped to `mcp-server-fetch==2026.8.18`, which upstream fixed by capping the
   dependency itself (`mcp<2,>=1.29.0` in its PyPI `requires_dist`); pip now resolves `mcp` 1.30.0,
   which still exports `McpError`. The constraint belongs in the package metadata, not duplicated
   in our script — so `install_python_into` still takes one spec.
2. **The bundle could not be repaired by the tool that creates it.** `install_python_into` skipped
   on "directory exists", so changing the pin changed nothing on any machine that had already
   provisioned, and re-running provisioning printed `already present` — which reads like success.
   Each bundle now carries a `.provision-spec` stamp; a spec mismatch wipes and reinstalls.
3. **The child's stderr was swallowed.** A server that dies at startup never speaks JSON-RPC, so
   `mcpclient.DialStdio` reported only `transport closed` — the symptom every startup failure
   shares — while the child had already printed the answer. `DialStdio` now drains the child's
   stderr (bounded 2 KiB / 500 ms, *before* Close reaps the pipe) into the dial error. Guarded by
   `TestStdio_DialErrorCarriesChildStderr`, proven RED: without the drain the message is exactly
   `mcp server unreachable: stdio initialize [...]: transport error: transport closed`.

### #19 — the traffic recorder silently removed `Flush` from every public route

Not test drift. The testid never moved (`ChatTranscript.tsx:100` still renders
`tool-throbber-${tool.name}`) and the tool DID run (archived `backend.log`:
`agent tool start … name=corpus_read`). Measured on a live stack, with the mock holding 2.5 s
after `corpus_read` so the window could not be missed: `chat-progress` read **THINKING** for the
whole hold, and then `retrieval-summary` (built from `tool_completed`) and `answer-body` appeared
in the **same 150 ms sample**. Tool frames written seconds earlier reached the browser only when
the handler returned — **the turn is delivered as one batch**, which is exactly the buffering
regression this spec's own header says it exists to catch.

**Root cause**: `backend/internal/monitor/mw/middleware.go` — `statusRecorder` embeds the
`http.ResponseWriter` **interface**, which promotes `Header`/`Write`/`WriteHeader` and nothing
else. `Record` is on **every** public route (`boot_http_public.go:57`, via `recordedRoute`),
`POST /api/v1/agent/turn` included. So downstream `pickFlusher` (`inference/proxy.go:172`) got
`nil` and `writeSSEFrame` skipped every flush (`inference/proxy_wire.go:286`:
`if flusher != nil`), while `http.NewResponseController` lost the write deadline
(`inference/agent_turn.go:203`). The second loss was **already in the archived log** and nobody
read it: `agent turn: extend write deadline unsupported … "feature not supported"` — that WARN is
the fingerprint of an opaque writer wrapper, and it also means `http.Server.WriteTimeout` can cut
any long turn again (F-A-44).

Two capabilities disappeared and neither reported it: a nil flusher is "then don't flush", a
missing deadline is a WARN. [[empty-is-not-json-null]] in the writer chain.

**Fix**: the recorder hands on what it does not use — `Unwrap()` (what `ResponseController`
follows) plus `Flush()` (a plain `w.(http.Flusher)` assertion does **not** follow `Unwrap`).
Guard: `internal/monitor/mw/middleware_writer_test.go`, proven RED by disabling the two methods
(`statusRecorder is not an http.Flusher — every SSE frame under Record buffers…`).

`login_guard.go`'s `bufferedWriter` has the same embedded-interface shape and is deliberately
left alone: it exists to buffer, so forwarding `Flush` would defeat it, and no SSE route is
behind it.

Harness note: the mock's `[[slow-final:N]]` hold moved from `serveStream` (where it sat behind
`hasToolResult("corpus_read")`, the mock **inferring** from wire shape which call was the last
one) into `emitFinalReply`, the only path that emits a final answer — dispatch has already
decided that by then, so no inference is needed. `has_read_result` is now **logged, not branched
on** (measured `true`, with `shape=user:text|assistant:tool_use|user:tool_result|assistant:tool_use|user:tool_result`),
so the wire shape stays visible without anything depending on it. This did not cause the red; it
removes a device that could fail quietly while looking like a product defect.

### #1 — a test device whose teardown could fail the test

The product is fine: `admin-nav-skeleton-fast.spec.ts` asserts the same skeleton on the same
build, on a stricter budget (1500 ms), and is green. `admin-nav-skeleton.spec.ts` passes **alone**
and failed only inside the full suite — a load-dependent race, not a defect.

`releaseData()` only RESUMES the held handlers, on a microtask; they are still inside
`route.continue()` while the test walks on to `await page.unroute(…)`. Plain `unroute` removes the
pattern without waiting for them, Playwright continues those routes itself, and the handler's own
`continue()` then throws `Route is already handled!` from line 38 — pointing at the product.
The alternative reading (the page cancelled a held request) has no mechanism: the only
`AbortController` in `app/src` is inside the long-poll worker (`lib/long-poll/long-poll.worker.ts`),
and `useMicrosites` — its only mount — is not on dashboard or wiki.

**Fix**: `page.unrouteAll({ behavior: 'ignoreErrors' })`. Every product assertion is unchanged;
only the teardown of the device stops being able to fail the test.

### #16 — the preamble described the shape the product left behind

Also passes alone (484 ms) and failed only in the suite: a race against the very probe the spec
is about. `expect(page.locator('body')).toBeVisible()` asserted nothing about F-L-11, and after
the mount probe 401s it cannot hold — `session-recovery.ts:50` rescues the code into pending, and
`visitor-root.tsx:47` renders the name picker as a **replacement** view, not an overlay, so the
whole body is one fixed-position modal and its layout box is empty. Whether the assertion passed
depended on whether the probe had resolved yet.

**Fix**: assert the real post-recovery contract instead — `visitor-name-overlay` visible, then the
strip hidden. Strictly stronger: `toBeHidden` on the strip passes just as well when nothing ever
rendered ([[negated-assertion-passes-while-absent]]), so on its own it could not tell "validated
away" from "not there yet"; the picker is the half that proves the probe ran.

Also fixed in passing: `make dev-logs` ran `docker compose` with **no `-p`**, so on a machine
running several per-checkout stacks it read whichever project the default naming resolved to —
another checkout's logs, presented as this one's.

---

## Still open, merged deliberately (owner's call, 2026-09-09)

**`microsite-editor-live-follow.spec.ts:66` — 1 red in 1748, intermittent, NOT root-caused.**
In the final full suite it timed out after 300s with the staging preview still on `INITIAL`.
Recorded here rather than left as folklore, with what is proven and what is not:

**Proven.** `resetInstance()` TRUNCATEs `microsite_builds` (`truncate cascades to table
"microsite_builds"` in the reset log), while the builder is a long-lived container that outlives
any one spec's data. A build still in flight when that happens cannot report:
`patch build err="mark built: no rows in result set"` → 500 (backend), `mark built: 500` (builder).
Reproduced twice. Both `mark built` and `mark failed` fail, so it is independent of the build's
outcome.

**NOT proven — and two readings were wrong on the way here.** (1) "It is contention for the
builder": builds take ~3s each and the builder is never starved; the claim had no evidence.
(2) The 500 is a *symptom*, not the cause — the reset that truncates the row belongs to the NEXT
spec, so it fires only after live-follow has already timed out. (3) A reproduction that showed a
30s `beforeAll` timeout was **contaminated**: six `make stack-retire` runs (`docker compose down -v`)
were executing concurrently. On a quiet machine the same six microsite specs at REPEAT=3 are
**57 passed / 0 failed in 3.3 min**, with zero `mark built: 500`.

So the failure needs the full suite's load to appear, and the two things that would have made it
attributable — bounded container logs and `build_id` on the patch-build error — landed only after
that run. The next full suite has both.

**What is worth fixing regardless of this red:** a test reset and a long-lived builder are not
coordinated. Production never truncates these tables, so this is a harness defect; the reset should
drain or pause the builder before truncating, rather than deleting rows out from under work in
progress.

## Round status (2026-09-08)

Batches A–E written from the archive; none started. Batch order is by blast radius: B and C are 9
of the 22 and share one helper each.

## Closing rules (SOP — carried from this file's prior rounds)
- A batch is done only when `make test-only SPEC="<spec>" REPEAT=5` is all green.
- Inside a batch, only edit — don't run. At the batch boundary, once: `make test-red SPEC=…` (prove
  red against the STILL-RUNNING unfixed images) → one `make dev-up` → one `make test-only` (green)
  → one `make lint`. A second build for one batch means the batch was cut wrong.
- **No pre-existing exemption. Every red goes green.**
- **Run the full suite once, only after every batch is REPEAT=5 green.**
