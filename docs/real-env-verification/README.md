# Fully-real verification (完全真实的验证)

Re-run, by hand, every path CI only ever validated against a mock — this time on a stack of **real services + real credentials, zero mocks** (`make prod-up`). The methodology is the skeleton here:

- **`sop.md`** — the flow and iron rules (**read first**). Core: a real-env failure IS a test-quality defect; fixes go "record → attribute to the test → TDD → manual re-verify".
- **`items/`** — one doc per verification item (§A–§R), each decomposing its sub-items into runnable steps + expected + the backing e2e.
- **`findings.md`** — ledger of real-env mismatches found during the manual phase (`F-<item>-<n>`); step 3 attributes + fixes each.
- **`inventory.md`** — the raw inventory (mock↔real mapping, file:line evidence). Credentials in `~/.config/standmeet/verify-creds.env`.

## 1. Verification items

| Item | What it verifies (one line) | Scope | Doc |
|----|------|-------|------|
| **§A** | Real-LLM agent (grounding / retrieval / subjectivity / injection-refusal / resume authoring) | ✅ runnable · DeepSeek | [A-real-llm](items/A-real-llm.md) |
| **§B** | Real Google Calendar (connect / freeBusy / book / cancel / 409) | ✅ runnable · GCAL creds | [B-calendar](items/B-calendar.md) |
| **§C** | Real mail (access-code email / confirmation / STARTTLS+AUTH / SaaS) | ✅ runnable · Gmail SMTP | [C-mail](items/C-mail.md) |
| **§D** | Real external MCP server (auth / SSE / large schema / real call) | 🟡 self-serve · real MCP server | [D-external-mcp](items/D-external-mcp.md) |
| **§E** | Real job-board fetch (schema/pagination/dedup) | ✅ public sources · E4 Workable ⛔skip | [E-job-boards](items/E-job-boards.md) |
| **§F** | Real marketplace (GitHub search / install skill) | ✅ public · F3 SkillsMP 🚫fiction | [F-marketplace](items/F-marketplace.md) |
| **§G** | Real Turnstile (siteverify / replay-reject / forged-reject) | ✅ runnable · public test keys | [G-captcha](items/G-captcha.md) |
| **§H** | Real connector (Cal.com OpenAPI / OAuth / SSRF-block / CalDAV) | ✅ Cal.com · CalDAV 🟡Radicale | [H-connector](items/H-connector.md) |
| **§I** | Storage / PDF / deploy (MinIO / gotenberg / TLS) | ✅ I1-3 · I4 🚫provider | [I-storage-pdf](items/I-storage-pdf.md) |
| **§J** | API-key facade (retrieval / rate-limit / isolation / no-leak) | ✅ runnable | [J-api-key](items/J-api-key.md) |
| **§K** | Sandbox egress (AllowNet vs no-net / prod docker driver / cron) | ✅ runnable | [K-sandbox](items/K-sandbox.md) |
| **§L** | Real Obsidian vault sync+render (classify/tolerant-fm/wikilink/render face) | ✅ **priority#1** · real vault | [L-vault](items/L-vault.md) |
| **§M** | Real MCP client ingest (tools/list 125 / one ingest turn) | ✅ SDK client | [M-mcp-client](items/M-mcp-client.md) |
| **§N** | Prod deploy-config forks (plugins/timeout/turnstile/storage) | ✅ observe prod stack | [N-deploy-forks](items/N-deploy-forks.md) |
| **§O** | SDK / web-components embed (cross-origin CORS / SSE / redemption) | ✅ local 2nd origin | [O-sdk-embed](items/O-sdk-embed.md) |
| **§P** | Cross-cutting live-only (Retry-After / rotation / eviction / models) | 🟡 P4/5/6 runnable | [P-cross-cutting](items/P-cross-cutting.md) |
| **§Q** | Product loops (recruiter QR scan / request→approve→email / ingest→answer) | 🟡 Q1 phone last | [Q-loops](items/Q-loops.md) |
| **§R** | BYOAI against a real provider (real stream + private-corpus exclusion) | ✅ DeepSeek as visitor key | [R-byoai](items/R-byoai.md) |

## First-pass results (2026-07-13, real prod stack)

| Item | Outcome |
|----|------|
| §A real LLM | 🔴 F-A-1 (visitor chat `tools:0` — no retrieval bound), F-A-2 (corpus-search box violates thesis). Voice fidelity ✓ (DeepSeek answers in owner voice). Grounding blocked. |
| §B calendar | 🔴 F-B-1 (dup connector forms), F-B-2 (Authorize → `/init` 404 — can't connect). Creds save ✓; OAuth dance dead. Redirect URI registered in Google. |
| §C mail | 🔴 F-C-1 (sidebar 404→ZodError), F-C-2 (smtp manifest invalid → form 400), F-C-3 (SMTP save doesn't persist, test-send silent false). Blocked. |
| §D external MCP | ✅ **PASS (real, 2nd pass)** — stood up a genuine `@modelcontextprotocol/server-everything` (streamable-http) on the prod network, registered via `/api/admin/mcp-servers`, granted to a role + code. Visitor turn: backend dialed it, `tools:13` bound, agent called `ext_everything_echo("pineapple")` → real server received initialize+tools/list+tools/call, returned a result. **Also independently confirms F-A-1 is sandbox-only**: network-dialed ext MCP works (13 tools) while the bwrap builtins fail in the same turn. |
| §E job boards | ✅ **E1 pass** — real Greenhouse (GitLab) fetch via MCP returned live jobs. F-E-1 (dead "+board"/"+rss" buttons, MCP-only). |
| §F marketplace | 🟡 `marketplace.search` returned `[]` (no GitHub call visible in logs — inconclusive; needs a query with known matches). |
| §G captcha | ✅ **PASS (real, 2nd pass)** — enabled Turnstile (Cloudflare dummy test keys) on prod + restart: `captcha_site_key` now exposed; login hits the **real** `challenges.cloudflare.com/siteverify`. Verdict flips with the secret: PASS-secret + token → 200, no token → 401, FAIL-secret + correct creds → 401 (`captcha verify failed: [invalid-input-response]`). Reverted to off. |
| §H connector | ✅ **H1 pass** — `validate_spec` on real Petstore OpenAPI 3.0 → ok, auth forms derived. UI path blocked (F-B-1/2). CalDAV (Radicale) untested. |
| §I storage/PDF | ✅ **pipeline PASS (real, 2nd pass)** — gotenberg up (chromium+libreoffice), MinIO live; rendered the **live app page → a real 102 KB PDF** via gotenberg url-convert over the actual network. Config sound: `GOTENBERG_URL` + `PRINT_BASE_URL=app.standmeet.local:3000` (deliberate network alias, resolves), `STORAGE_USE_SSL=false`. Resume PDF is host-side (NOT sandbox → not F-A-1-blocked); the full `resume.draft→commit` flow needs the owner-MCP path but the render pipeline is proven working. |
| §J api-key | 🔴 F-J-1 (`api_keys.create` needs a role; none by default → unreachable). `corpus.retrieval` openable. |
| §K sandbox | 🟡 skills are prompt-based (skill_list ✓); the script-sandbox egress (K1) not reached this pass. `SANDBOX_DRIVER=docker` confirmed (K2). |
| §L vault | 🔴 F-L-1 (obsidian page a dead mockup), F-L-2 (46% rejected + tree shattered), F-L-3 (subjectivity won't sync). L1 classify ✓, L5 links ✓ (644 edges), L10 KaTeX render ✓. |
| §M MCP client | ✅ **M1 pass** (125 tools via Sigv1), **M2 pass** (raw_dump + subjectivity_write land). |
| §N deploy forks | ✅ confirmed — plugins/turnstile/timeout unset, docker driver, storage SSL off (matches inventory). |
| §O SDK embed | 🔴 **F-O-1** — no CORS headers, preflight 405 → embed can't bootstrap cross-origin (zero coverage). |
| §P cross-cutting | ✅ **P5 confirmed** — no meili in prod → corpus_search on PG-FTS by default. P1/P2/P3 not reached. |
| §Q loops | ⛔ Q1 needs a phone (deferred); Q2/Q3 blocked downstream by §C mail / §A `tools:0`. |
| §R BYOAI | ✅ **envelope+stream PASS (real, 2nd pass)** — created a byoai session, replicated the client envelope (HKDF-SHA256(session_token, "standmeet-byoai-v1") → AES-256-GCM `nonce\|ct\|tag`, 63 B), POSTed `/agent/turn` with `X-Byoai-{Provider,Key,Endpoint,Model}`. Backend decrypted the visitor's **real DeepSeek key** server-side and **streamed a real answer** ("I am your AI assistant…"). Envelope + provider routing + streaming all work; grounding/public-corpus-ACL still blocked by F-A-1 (same sandbox root). |

Green surfaces: owner-MCP (§M/§E/§H/§N). Red surfaces: the admin UI + visitor chat (§A/§B/§C/§J/§L/§O). See findings.md "Through-line".

## 2. Per-item doc template

```
# §X — <Track name>
- Status: ⬜ not-run        (state machine: see sop.md §4)
- Scope:  runnable-now | self-serve | blocked(<what>) | de-scoped
- Prereqs/creds: <which verify-creds.env entries / which self-serve server>
- Real service: <the mock this replaces>
- Backing e2e: <the specs currently "covering" this — the attribution target>

## Sub-items
### X1 — <title>
- Steps: ...
- Expected: ...
- Backing test: <file:line>
- Result: ⬜
...

## Findings   (record here during the manual phase; also log ../findings.md, ID F-X-n)
```
