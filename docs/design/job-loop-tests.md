# StandMeet Job Loop — test design

> **Status:** Draft, awaiting review (2026-05-20). Read alongside [`job-loop.md`](job-loop.md).
> **Readers:** Whoever writes the fixtures / mock servers / specs.
> **How to give feedback:** Each block ends with `T.n` decision points; reply `Tn: accept` / `Tn: change — <…>`.

---

## TL;DR — testing philosophy

1. **CLAUDE.md's "no mocks for external deps" has a limit at the network boundary**. Job boards are truly external; CI cannot hit Greenhouse 100 times, and tests cannot depend on LinkedIn being online. **Mock at the HTTP layer**, **not at the fetcher layer** — the fetcher code is real; only its baseURL points at a fake server we start.
2. **No unit tests** (following the project rule). All coverage comes from e2e.
3. **UI-driven first** (the [[feedback-e2e-ui-driven-only]] rule). But when a surface has only an MCP entry point and no admin UI mirror, an MCP-driven spec is allowed (precedent: `corpus-curation.spec.ts`).
4. **Test files are named by business behavior** ([[feedback-e2e-ui-driven-only]]) — not `phase1-tests.spec.ts`, but `job-sources-register.spec.ts`.

**Decision point T.1: the philosophy above is accepted.**

---

## Network-layer mock strategy

### Job board mock server

Add a new docker-compose service `external-mock`: a lightweight HTTP server (written in Go at `backend/cmd/external-mock`, reusing the same binary as the backend, **not** node express) that serves fixture JSON / RSS on the paths below:

```
GET  /greenhouse/v1/boards/{co}/jobs?content=true
GET  /lever/v0/postings/{co}?mode=json
GET  /ashby/posting-api/job-board/{slug}
GET  /remoteok/api
GET  /wwr/categories/{slug}.rss
GET  /hn/v0/user/whoishiring.json
GET  /hn/v0/item/{id}.json
```

The fixture file name convention behind each path: `e2e/fixtures/job-boards/{kind}/{co_or_slug}.{day}.{ext}` — for example `greenhouse/airbnb.day1.json`, `lever/leverdemo.day1.json`, `hn/whoishiring.day1.json` + `hn/item-{id}.json`.

The mock server takes a query param so a spec can switch "the world as seen today":
- `?day=1` / `?day=2` — decides which fixture to serve (a spec changes the mock's "current day" across HTTP via the environment, or via a special admin endpoint `POST /__mock/set_day?day=2`)

The backend switches base URLs through environment variables; **production does not set these env vars**:

```
GREENHOUSE_BASE_URL=http://external-mock:9000/greenhouse
LEVER_BASE_URL=http://external-mock:9000/lever
ASHBY_BASE_URL=http://external-mock:9000/ashby
REMOTEOK_BASE_URL=http://external-mock:9000/remoteok
WWR_BASE_URL=http://external-mock:9000/wwr
HN_BASE_URL=http://external-mock:9000/hn
```

In the fetcher code the default const = the real URL; a non-empty env overrides it. Also, **every fetcher uses the same injected `*http.Client`** (an existing pattern); specs do not rewrite the client, only the URL.

**Decision point T.2: fetcher → URL override env; the mock server shares the backend binary; fixtures are named kind/{co}.day{n}.{ext}.**

### LLM mock boundaries (**three of them**, spelled out)

"AI doing the work" shows up in three different places in the system; e2e uses a separate stand-in for each — do not mix them:

| LLM call site | Who calls | e2e stand-in |
|---|---|---|
| **A. Visitor chat reply** (a recruiter scans the QR, comes in and sends a message; the AI answers in the owner's voice) | backend (`internal/inference`) → Anthropic API | The existing `INFERENCE_PROVIDER=mock` switches the provider to MockProvider; e2e already used it, and `qr-scan-to-chat` reuses it directly. **Do not write a new one**. |
| **B. The owner in Claude Code "revising"/"writing" a resume / ranking jobs** (real production: Claude takes the owner's MCP context + reasons on its own) | **the owner's Claude,** not inside the StandMeet process | In e2e "Claude" does not exist — **the test code itself plays Claude**: it feeds prepared fixture JSON to `resume.draft(...)` as "the resume_content Claude wrote", and uses fixture criteria as the job-ranking result to assert on. Fixtures live in `e2e/fixtures/resume/*.json`, `e2e/fixtures/application/*.json`. |
| **C. Server-side reasoning about a job / resume** (hypothetical: the backend extracts HN free text into a structured FetchedJob, the backend scores a resume) | **does not exist by design** — see decision L.1 "Division of state and reasoning" in [job-loop.md](job-loop.md) | n/a — we have no such path; e2e does not need to mock an LLM on the server |

**Decision point T.11: the three LLM boundaries are explicit**: (A) MockProvider already exists, (B) the test code plays Claude with fixture content, (C) the server makes no LLM calls, so there is no mock. Any PR that wants to add a server-side LLM call must first be reviewed separately — it would overturn the division-of-work principle.

#### Fixture quality bar (type-B fixtures cannot be sloppy)

When a test fixture stands in for "Claude's output", it **must look like real Claude output**:

- `resume_content_alice.json` contains at least: 1 work with 5+ bullets, 3 STAR projects (each section 30+ characters), 4 skill categories, 1 education entry, 2 links
- `application_acceptance_alice.json` feeds at least 5 tags (simulating the tag set Claude derives from the JD)
- **Do not** use a perfunctory fixture like `{"name":"Test","email":"t@t.t"}` — that kind of fixture makes PDF rendering / field assertions look like they pass while missing a pile of edge cases

**Decision point T.12: the fixture content quality bar goes into `e2e/fixtures/README.md`, and code review enforces it.**

### Existing mocks: reuse

- **The mock inference provider** already lives in `internal/inference/mock.go`, enabled in e2e via `INFERENCE_PROVIDER=mock` — reuse it directly for the QR-scan-to-chat path. **Do not write a new one**.
- **The mock token / setup token** already lives in `e2e/fixtures/instance.ts` — reuse it directly.
- **resetInstance**: **add `job_sources`, `job_fingerprints`, `resume_drafts`, `applications`** — the three new tables — to the existing truncate list.
- **Redis FLUSHALL** is already in resetInstance; the TTL job pool is cleared with it, no change needed.

**Decision point T.3: reuse all existing mock infrastructure; extend resetInstance's TRUNCATE list.**

---

## PDF / QR verification strategy

**Scan for real: every QR-related spec decodes the image from the PDF.** Reason: what we test is the behavior itself — "can a recruiter who gets the PDF scan the URL out of it". A QR that is too small / distorted by anti-aliasing / has too little margin / uses too low an ECC level so a phone cannot scan it — all of these can only be found by decoding the real image. Trusting the `deeplink_url` field tests only backend logic, not the PDF render output.

1. **PDF text layer**: `pdf-parse` extracts the text; assert that name / email / company name / project name etc. appear.
2. **PDF image + QR decoding** (**the new main path**):
   - Extract a helper `e2e/fixtures/qr.ts`: `export async function scanQRFromPDF(buf: Buffer): Promise<string>`
   - Implementation: `pdfjs-dist` renders the first page to a canvas (on Node, use `@napi-rs/canvas` or a similar polyfill), crops the top-right region and hands it to `jsqr` to decode, returning the URL string
   - **Decision point T.4a**: the implementation uses `pdfjs-dist + @napi-rs/canvas + jsqr` rather than `pdftoppm` (so e2e brings in no system-level dependency and stays reproducible inside the container)
3. **`applications.show()` still returns `invitation.deeplink_url`** — for the owner's /admin/applications UI ("copy link", "preview QR target"). Specs treat it as one cross-check comparison item, **not** as ground truth. Ground truth = the scanned URL.
4. **The `qr-scan-to-chat` loop spec strictly follows "the recruiter path"**: commit → PDF → scanQR → goto(scannedURL) → chat. Short-circuiting through applications.show().deeplink_url in between is not allowed.

**Decision point T.4: every QR-related spec scans the image from the PDF for real. `applications.show().deeplink_url` is only for the UI and cross-checks, not e2e ground truth.**

---

## Time mocking

TTL tests cannot really wait 24 hours. Use two paths:

- **Redis TTL**: after a spec gets a `job_cache_id`, it connects to redis directly through docker exec and sets a short TTL on the key (`PEXPIRE ... 100`), waits 200ms, then fetches to verify it is gone.
- **PG `expires_at`**: a direct psql UPDATE.

**No** fake clock / no "time provider" abstraction added to the code. **Decision point T.5: time is handled by manipulating Redis/PG state directly through docker exec; no clock abstraction is introduced.**

---

## Phase 1: job sources + fetcher + Redis TTL pool

### 1.1 `job-sources-register.spec.ts`

**Business behavior:** the owner adds a Greenhouse source in /admin/sources and sees it in the list immediately.

UI path:
1. claim → login → go to `/admin/sources` (new section)
2. click `+ new source` → choose kind=greenhouse → fill in `company=airbnb` + label="Airbnb careers" → create
3. a `Airbnb careers` row appears in the list (`testid: source-row-airbnb`)
4. click unregister → it disappears from the list

API side-check: at the end, the spec also uses MCP `jobs.list_sources()` to confirm 0 entries (cleanup is complete).

### 1.2 `job-fetch-deduplicates.spec.ts`

**Business behavior:** fetch twice, the second is empty — jobs already seen do not appear again.

Mock config: fixture `greenhouse/airbnb.day1.json` = 3 jobs (id=A, B, C).

1. setup: register the Airbnb source via UI (or the faster fixture API)
2. MCP `jobs.fetch_new()` → assert 3 entries, each with a `cache_id`
3. MCP `jobs.fetch_new()` called again immediately → assert 0 entries (same source, unchanged; every fingerprint hits)
4. mock server `POST /__mock/set_day?day=2`, switches to `airbnb.day2.json` = 4 jobs (B, D, E, F — A/C are gone, D/E/F are new)
5. MCP `jobs.fetch_new()` → assert 3 entries (D, E, F), not B (already fingerprinted)

### 1.3 `job-fetch-multi-source.spec.ts`

**Business behavior:** register two sources of different kinds; fetch_new returns the union of both.

1. register greenhouse:airbnb + hn_hiring
2. mock: airbnb 2 entries + 3 comments on this month's HN whoishiring post
3. MCP `jobs.fetch_new()` → assert 5 entries
4. check that the response has a `source_kind` field to tell them apart

### 1.4 `job-fetch-ttl-eviction.spec.ts`

**Business behavior:** a fetched job disappears automatically after 1 day; `jobs.show(cache_id)` returns not_found.

1. register a source + fetch → get a `cache_id`
2. docker exec redis-cli `PEXPIRE job:{owner_id}:{cache_id} 100`
3. wait 200ms (or verify by polling)
4. MCP `jobs.show(cache_id)` → assert a `not_found` envelope

### 1.5 `job-discard.spec.ts`

**Business behavior:** `jobs.discard(cache_id)` makes `jobs.show(cache_id)` 404 immediately.

A short spec, one behavior.

### 1.6 `mcp-jobs-auth.spec.ts` (small)

**Business behavior:** calling `jobs.fetch_new` with no token / a wrong token returns unauthorized.

Mirror the `mcp-auth.spec.ts` pattern, adding the `jobs.*` tools. **Decision point T.6: reuse the existing mcp-auth.spec.ts code skeleton; do not start a new one.**

---

## Phase 2: resume draft → preview → commit (the preview part)

### 2.1 `resume-draft-preview.spec.ts`

**Business behavior:** Claude feeds resume_content → the backend returns a preview PDF URL; the PDF contains the owner's identity fields, and the QR slot is a placeholder.

1. setup: register a source + fetch → get a `job_cache_id`
2. the spec uses a hand-crafted fixture `resume_content_alice.json` (standard identity + 1 work + 1 STAR project + skills)
3. MCP `resume.draft(job_cache_id, content)` → assert it returns `{draft_id, preview_pdf_url}`
4. HTTP GET `preview_pdf_url` → `pdf-parse` extracts the text → assert `"Alice Anderson"`, email, company name and project name are all there
5. assert the PDF text does **not** contain a real access code string (QR placeholder at the preview stage)

### 2.2 `resume-draft-update.spec.ts`

**Business behavior:** update_draft changes the content → the preview PDF is recomputed.

1. draft produces v1 → capture the PDF md5
2. update_draft swaps the summary for another sentence → the PDF md5 changes → text check that the new summary appears

### 2.3 `resume-draft-discard.spec.ts`

**Business behavior:** discard → a later commit of the same draft_id returns not_found.

### 2.4 `resume-draft-ttl.spec.ts`

**Business behavior:** the draft's 1d TTL expires → commit returns not_found.

PG `UPDATE resume_drafts SET expires_at = now() - interval '1h' WHERE id = '...'`, then commit.

---

## Phase 3: commit + invitation + QR + ?code full chain

### 3.1 `application-commit-issues-invitation.spec.ts`

**Business behavior:** commit a draft → one row is written to the applications table + one row is automatically added to access_codes (with correct defaults) + the final PDF is rendered + the URL decoded from the QR in the PDF is correct.

1. setup: fetch → draft → commit
2. assert `applications.show(application_id)` returns:
   - `invitation.expires_at` ≈ `applied_at + 180d` (tolerance ≤ 1 minute)
   - `invitation.max_sessions_per_member == 10`
   - `invitation.max_turns_per_session == 50`
   - `invitation.label == "{title} @ {co}"`
   - `invitation.suggested_questions.length == 4`
3. assert `pdf_url` is reachable + the text layer contains the owner identity + work content
4. **scan the QR from the PDF for real**: `scanQRFromPDF(buf)` → assert the URL looks like `https://{public_url}/{handle}?code={non_empty_code}` and `code === invitation.code`
5. the invitation is visible in the /admin/codes UI list (label matches)

### 3.2 `application-qr-image-quality.spec.ts`

**Business behavior:** the QR rendered in the PDF can be scanned across several PDF handling paths (direct fetch, fetch after compression, fetch after scaling). This leaves margin for a recruiter who forwards / screenshots / scales the PDF and then actually scans it.

1. setup: commit → `pdf_url`
2. fetch PDF → scanQR → passes
3. fetch PDF → re-render at 50% (with pdfjs-dist + a small viewport) → scanQR → passes
4. fetch PDF → take the first page as PNG → convert to JPEG quality=70 → scanQR → passes
5. (this spec also guards that the QR ECC level is high enough + the margin is large enough)

### 3.3 `qr-scan-to-chat.spec.ts` (**the key to closing the loop**)

**Business behavior:** **strictly follow the recruiter path**: take the PDF → actually scan the QR to get the URL → goto → no /gate → straight into chat → send a message → receive a reply → `?code=` is already erased from the URL.

Short-circuiting through `applications.show().deeplink_url` in between is **not allowed**.

1. setup (full chain): fetch → draft → commit → get `pdf_url`
2. fetch the PDF buffer → `scannedURL = await scanQRFromPDF(buf)`
3. `page.goto(scannedURL)`
4. assert the url is at `**/{handle}`, not `**/gate`
5. assert the chat input appears (not the gate code input box)
6. assert `page.url()` does not contain `?code=` (history.replaceState took effect)
7. send `"tell me about Alice"` in chat
8. assert a reply appears + the reply text = the `INFERENCE_MOCK_REPLY` configured for the mock provider
9. owner's view: open that invitation's detail in /admin/codes, and see 1 visitor came in + 1 conversation

### 3.4 `application-list-shows-applied.spec.ts`

**Business behavior:** the /admin/applications UI lists what has been applied to.

1. setup: commit one
2. UI: visit /admin/applications → assert the row appears (`testid: application-row-{id}`) → shows title @ company + applied_at
3. click the link → goes to the /admin/codes/{invitation_id} detail

### 3.5 `application-withdraw-revokes-invitation.spec.ts`

**Business behavior:** changing status=withdrawn in the /admin/applications UI → the invitation shows as revoked in /admin/codes.

1. setup: commit
2. UI: /admin/applications row → click "..." → choose "Withdraw" → confirm modal
3. assert the row status badge = `withdrawn`
4. UI: that code in /admin/codes → assert status = `revoked`
5. at the end, the spec hits this code once more with a visitor session create → assert the backend returns `code_invalid` (already revoked)

### 3.6 `application-next-event-manual.spec.ts`

**Business behavior:** the owner fills in `next_event_at` by hand — the slot reserved for the calendar PR gets the UI working first.

1. setup: commit
2. UI: the row has "set next event" → fill in date `2026-06-10 14:00` + notes "phone screen"
3. assert the row's `next_event_at` column = that date
4. reload → still there

### 3.7 `application-commit-rehydrates-job.spec.ts`

**Business behavior:** after the job is evicted from the Redis pool during the draft stage (TTL expired), **commit still succeeds** — because of decision L.13 (the job is snapshotted into the draft row when the draft is created).

1. setup: fetch → draft → docker exec kills the Redis key
2. commit → assert success + applications.job_snapshot matches the fixture content as fetched

---

## Phase 4: playwright hint

### 4.1 `commit-response-has-playwright-hint.spec.ts`

**Business behavior:** the `next_action_hint` field exists in the commit response, and its text contains `playwright`, `apply_url`, `pdf_url`.

A short spec, a single contract test.

---

## Cross-phase tests

### X.1 `multi-tenant-job-isolation.spec.ts` (insurance)

**Business behavior:** sources registered by owner A, the fingerprints they produce, and applications are not visible to owner B.

Although v1 is a single-owner instance, every table is already partitioned by owner_id; this spec guards against regression. It needs two owners — the `claim` path through the setup token can claim only once, so this spec first needs the instance manually changed to support multi-tenant (or a second owner row inserted directly into PG as a fixture).

**Decision point T.8: this test is **not** on the must-run list for phases 1–3; it will be written when multi-tenant is opened up.**

### X.2 `mcp-source-config-validation.spec.ts`

**Business behavior:** register_source with a wrong config shape → returns a parameter error.

Each source kind has a schema:
- greenhouse needs `company`
- lever needs `company`
- ashby needs `slug`
- remoteok needs no config (aggregate)
- wwr needs `categories: []`
- hn_hiring needs no config

The spec feeds a wrong config and asserts envelope code=`bad_request`, with a message saying which field is missing.

---

## Fixture inventory — **real snapshots captured** (2026-05-20)

The actual capture output is in `e2e/fixtures/job-boards/`, covering:

| Source kind | Real boards | File names |
|---|---|---|
| `greenhouse/` | 25 | `airbnb`, `stripe`, `vercel`, `figma`, `anthropic`, `dropbox`, `instacart`, `pinterest`, `reddit`, `gusto`, `duolingo`, `elastic`, `gitlab`, `cloudflare`, `datadog`, `mongodb`, `mercury`, `chime`, `brex`, `lyft`, `robinhood`, `asana`, `affirm`, `fivetran`, `samsara` |
| `lever/` | 4 | `leverdemo`, `highspot`, `jobvite`, `palantir` |
| `ashby/` | 4 | `Ashby`, `Linear`, `Notion`, `posthog`, `supabase` |
| `remoteok/` | 1 | `api` (aggregate) |
| `wwr/` | 10 | all 10 category RSS feeds |
| `hn/` | 10 | `whoishiring` + `item-47975571` (May 2026 thread) + 8 real postings |
| `smartrecruiters/` | 1 | `visa` (v1.1) |
| `workable/` | 6 | `typeform`, `mux`, `marshmallow`, `intercom`, `mistralai`, `rechargehq` (v1.1, **note**: `widget/accounts` returns account metadata, not jobs; the jobs endpoint will be confirmed when the adapter is implemented) |

Each fixture is **trimmed to ≤ 8 jobs / items to keep git size down** (4 MB total). The full untrimmed raw captures go in `.raw/` (gitignored).

Tool scripts:
- `e2e/fixtures/job-boards/capture.sh` — re-captures raw (curl against the real API + a polite UA)
- `e2e/fixtures/job-boards/trim.sh` — cuts raw down to 8 entries into the git path
- `Makefile`: `make capture-job-fixtures` / `make trim-job-fixtures` wrap them
- `e2e/fixtures/job-boards/README.md` — inventory + day2 generation convention

### day2 fixtures (for the dedup test)

day2 does not hit the real API again — **it is derived from day1** (the first 2 entries disappear + 2 new ones are added at the end), so real API drift does not disturb the expected day1 → day2 diff. The day2 manifest (each board's expected "set of new IDs") is generated by `gen-day2.sh` + imported by e2e.

### Application + resume fixture

```
e2e/fixtures/resume/
└── resume_content_alice.json   # rich content per the T.12 standard

e2e/fixtures/application/
└── application_acceptance_alice.json   # commit input (draft_id placeholder)
```

**Decision point T.9: fixtures are maintained by hand through `make capture-job-fixtures`** (rate limit + drift control), refreshed quarterly. The captured snapshot timestamps are recorded in [`e2e/fixtures/job-boards/README.md`](../../e2e/fixtures/job-boards/README.md).

---

## CI / local make integration

The new docker-compose service `external-mock` starts on port 9000. The existing docker-compose up --wait in `make test` brings it up.

New specs are collected naturally by `pnpm exec playwright test`; the playwright config does **not** need to change.

**Decision point T.10: the mock server is a docker-compose service on par with backend / app / db / redis; `make test` includes it.**

---

## Open questions (not blocking)

- **How often fixtures sync with the real API**: we need a `make verify-fixtures` (not built yet) that runs against the real API and compares the latest structure (run once a quarter).
  **This has already moved from "future" to "has happened"** (2026-08-19 real-environment audit): RemoteOK now sends `location` with a trailing comma
  (`"San Francisco, "`), while not one of the 99 entries in the fixture captured on 2026-05-20 has it — so the stand-in was politer than the real world,
  and UX-88 survived into production with e2e all green. Also, three kinds — `jba` / `workday` / `bamboohr` — **have an empty `.raw/`**:
  their fixtures are hand-written, never checked against the real vendor, and can only ever agree with the adapter's own idea.
- **Captcha / rate limit in the mock server**: not simulated for now. Add it if a real need appears for the fetcher to handle 429.
- **HN monthly switch-over**: HN whoishiring changes its post on the 1st of each month. A fixture is always a snapshot of one specific month. The fetcher uses `whoishiring.submitted[0]` to get the "latest" one — the mock fixture just needs to be ordered by the same contract.

---

## Decision point summary

T.1 Testing philosophy (mock at the network boundary / e2e only / UI-driven first / business naming)
T.2 fetcher URL override env + mock server shares the backend binary + fixture naming convention
T.3 Reuse existing mock infrastructure + extend resetInstance's truncate list
T.4 QR verification **always scans the PDF for real**; `deeplink_url` is only for UI / cross-checks, not ground truth
T.4a Implementation uses `pdfjs-dist` + `@napi-rs/canvas` + `jsqr` (no system-level dependency like `pdftoppm`)
T.5 Time is handled by changing Redis/PG state directly through docker exec; no clock abstraction
T.6 Reuse the existing `mcp-auth.spec.ts` skeleton
T.7 ~~Tag the PDF→QR image-decoding spec as regression-once~~ — merged into T.4; every QR spec runs every time
T.8 The multi-tenant isolation test is deferred until multi-tenant is opened up
T.9 Fixtures are maintained by hand through `make capture-job-fixtures`
T.10 The mock server goes into docker-compose
T.11 Three LLM boundaries: (A) reuse MockProvider, (B) test code plays the owner-side Claude and feeds fixture content, (C) the server makes no LLM calls, so no mock
T.12 Fixture quality bar (rich content, not sloppy) written into `e2e/fixtures/README.md`, enforced in code review
