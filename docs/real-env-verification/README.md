# Fully-real verification

Re-run, by hand, every path CI only ever validated against a mock — this time on a stack of **real services + real credentials, zero mocks** (`make prod-up`). The methodology is the skeleton here:

- **`sop.md`** — the flow and iron rules (**read first**). Core: a real-env failure IS a test-quality defect; fixes go "record → attribute to the test → TDD → manual re-verify". SOP §1b adds the task-free UI sanity sweep (each module carries a **⚠️ LOOK** block).
- **`items/`** — one doc per **module** (a functional unit + the surface it owns), each decomposing its checks into runnable steps + expected + the backing e2e + a fresh-eyes LOOK. Each module notes the historical `§`-findings it inherits.
- **`findings.md`** — ledger of real-env mismatches found during the manual phase. **Finding IDs stay `F-<letter>-<n>`** — a historical anchor from the old §A–§R axis; each module names which it inherits.
- **`inventory.md`** — the raw inventory (mock↔real mapping, file:line evidence), indexed by the historical § axis. Credentials in `~/.config/standmeet/verify-creds.env`.

## 1. Verification modules

One doc per **module** (a functional unit + the surface it owns). Grouped by product area; each carries its checks + a fresh-eyes **⚠️ LOOK** and names the historical `§`-findings it inherits.

**Visitor chat (agent reasoning)** — [chat-grounding](items/chat-grounding.md) · [chat-subjectivity](items/chat-subjectivity.md) · [chat-voice-persistence](items/chat-voice-persistence.md) · [chat-injection-refusal](items/chat-injection-refusal.md) · [chat-ghost](items/chat-ghost.md) · [chat-summarize](items/chat-summarize.md) · [chat-redaction](items/chat-redaction.md) ✅ · [chat-byoai](items/chat-byoai.md) · [dock-buttons](items/dock-buttons.md)

**Agent engine** — [agent-loop-robustness](items/agent-loop-robustness.md) · [agent-turn-boundary](items/agent-turn-boundary.md) 🟩

**Booking** — [calendar-connect](items/calendar-connect.md) · [booking-slots](items/booking-slots.md) · [booking-book](items/booking-book.md) · [booking-email](items/booking-email.md)

**Mail** — [mail-connector](items/mail-connector.md) ✅

**Connectors** — [connector-assembly](items/connector-assembly.md) · [connector-security](items/connector-security.md)

**Corpus / vault** — [vault-sync](items/vault-sync.md) 🟡 · [vault-links](items/vault-links.md) · [corpus-render](items/corpus-render.md) · [corpus-media](items/corpus-media.md) · [corpus-raw](items/corpus-raw.md) 🔴 · [corpus-search](items/corpus-search.md)

**MCP** — [ext-mcp](items/ext-mcp.md) ✅ · [owner-mcp](items/owner-mcp.md) ✅

**Jobs / applications** — [job-fetch](items/job-fetch.md) ✅ · [resume-draft](items/resume-draft.md) · [application-commit](items/application-commit.md) 🟡

**Facade / infra** — [marketplace](items/marketplace.md) 🟡 · [api-key-facade](items/api-key-facade.md) ✅ · [sandbox](items/sandbox.md) 🟡 · [deploy-forks](items/deploy-forks.md) ✅ · [resilience](items/resilience.md) · [custom-pages](items/custom-pages.md) 🔴

**SDK / captcha** — [sdk-embed](items/sdk-embed.md) 🔴 · [captcha](items/captcha.md) ✅

**Visitor entry / admin shell** (the previously-homeless surfaces) — [access-codes](items/access-codes.md) 🔴 · [gate](items/gate.md) · [admin-shell](items/admin-shell.md) 🟩

> **Two axes.** Modules above are the *feature* axis. The historical §A–§R was a *verification-substrate* axis ("which real dep to stand up") — it survives only as the `F-<letter>-<n>` finding IDs and in the first-pass results below. Each module's `Real dep:` header carries the substrate it needs, so runnability isn't lost.

## First-pass results (2026-07-13, real prod stack)

> Keyed by the historical §-axis (pre-module-recut). Each § now maps to one or more modules above — e.g. §A → `chat-*` + `agent-*` + `resume-draft`; §L → `vault-*` + `corpus-*`; §B → `calendar-connect` + `booking-*`. The per-finding detail was migrated into each module's own **Findings** section.

| Item | Outcome |
|----|------|
| §A real LLM | 🟡 **F-A-2 ✅fixed** (removed the thesis-violating visitor corpus-search box). **F-A-1 ✅FIXED** (3-layer deploy gap closed: bake plugins + SYS_ADMIN/NET_ADMIN sandbox caps → prod visitor turn tools:6, agent grounds on the real corpus). Voice fidelity ✓ (DeepSeek in owner voice). |
| §B calendar | 🔴 F-B-1 (dup connector forms), F-B-2 (Authorize → `/init` 404 — can't connect). Creds save ✓; OAuth dance dead. Redirect URI registered in Google. |
| §C mail | ✅ **now works** — F-C-1 ✅fixed, F-C-2 ✅fixed (protocol credential-form). Post-fix **verified real send**: Gmail app-pw via generic `/connectors/smtp/*` → connect(real handshake)→activate→`/mail/test-send` → `{ok:true}`, a real email out. F-C-3's "mail dead" resolved by F-C-2; the dead dedicated MailConnectorPanel remains as an F-B-1 dedup owner-decision. |
| §D external MCP | ✅ **PASS (real, 2nd pass)** — stood up a genuine `@modelcontextprotocol/server-everything` (streamable-http) on the prod network, registered via `/api/admin/mcp-servers`, granted to a role + code. Visitor turn: backend dialed it, `tools:13` bound, agent called `ext_everything_echo("pineapple")` → real server received initialize+tools/list+tools/call, returned a result. **Also independently confirms F-A-1 is sandbox-only**: network-dialed ext MCP works (13 tools) while the bwrap builtins fail in the same turn. |
| §E job boards | ✅ **E1 pass** — real Greenhouse (GitLab) fetch via MCP returned live jobs. F-E-1 ✅fixed (removed the dead +board/+rss buttons; sources are MCP-registered by design). |
| §F marketplace | 🟡 `marketplace.search` returned `[]` (no GitHub call visible in logs — inconclusive; needs a query with known matches). |
| §G captcha | ✅ **PASS (real, 2nd pass)** — enabled Turnstile (Cloudflare dummy test keys) on prod + restart: `captcha_site_key` now exposed; login hits the **real** `challenges.cloudflare.com/siteverify`. Verdict flips with the secret: PASS-secret + token → 200, no token → 401, FAIL-secret + correct creds → 401 (`captcha verify failed: [invalid-input-response]`). Reverted to off. |
| §H connector | ✅ **H1 pass** — `validate_spec` on real Petstore OpenAPI 3.0 → ok, auth forms derived. UI path blocked (F-B-1/2). CalDAV (Radicale) untested. |
| §I storage/PDF | ✅ **pipeline PASS (real, 2nd pass)** — gotenberg up (chromium+libreoffice), MinIO live; rendered the **live app page → a real 102 KB PDF** via gotenberg url-convert over the actual network. Config sound: `GOTENBERG_URL` + `PRINT_BASE_URL=app.standmeet.local:3000` (deliberate network alias, resolves), `STORAGE_USE_SSL=false`. Resume PDF is host-side (NOT sandbox → not F-A-1-blocked); the full `resume.draft→commit` flow needs the owner-MCP path but the render pipeline is proven working. |
| §J api-key | ✅ **PASS (F-J-1 was inaccurate)** — real Sigv1 owner-MCP `api_keys.create` with the **seeded public role** id → 200, minted `smk_…`. The public role is a persistent row (`SeedPublicRole` on claim), so minting works out-of-box; the first-pass "no default role" was a tester error (same red herring as F-A-1). `corpus.retrieval` openable. |
| §K sandbox | 🟡 skills are prompt-based (skill_list ✓); the script-sandbox egress (K1) not reached this pass. `SANDBOX_DRIVER=docker` confirmed (K2). |
| §L vault | 🟡 **F-L-2 ✅fixed** (source_path reconcile — real vault: errors 29→0, tree roots 24→5), **F-L-3 ✅fixed** (subjectivity ingests without publish — real vault: subjectivity rows 1→17). F-L-1 ✅fixed (page now renders the real ObsidianBar import/export; export fires a real .zip). L1 classify ✓, L5 links ✓, L10 KaTeX ✓. |
| §M MCP client | ✅ **M1 pass** (125 tools via Sigv1), **M2 pass** (raw_dump + subjectivity_write land). |
| §N deploy forks | ✅ confirmed — plugins/turnstile/timeout unset, docker driver, storage SSL off (matches inventory). |
| §O SDK embed | 🔴 **F-O-1** — no CORS headers, preflight 405 → embed can't bootstrap cross-origin (zero coverage). |
| §P cross-cutting | ✅ **P5 confirmed** — no meili in prod → corpus_search on PG-FTS by default. P1/P2/P3 not reached. |
| §Q loops | ⛔ Q1 needs a phone (deferred); Q2/Q3 blocked downstream by §C mail / §A `tools:0`. |
| §R BYOAI | ✅ **envelope+stream PASS (real, 2nd pass)** — created a byoai session, replicated the client envelope (HKDF-SHA256(session_token, "standmeet-byoai-v1") → AES-256-GCM `nonce\|ct\|tag`, 63 B), POSTed `/agent/turn` with `X-Byoai-{Provider,Key,Endpoint,Model}`. Backend decrypted the visitor's **real DeepSeek key** server-side and **streamed a real answer** ("I am your AI assistant…"). Envelope + provider routing + streaming all work; grounding/public-corpus-ACL still blocked by F-A-1 (same sandbox root). |

Green surfaces: owner-MCP (§M/§E/§H/§N). Red surfaces: the admin UI + visitor chat (§A/§B/§C/§J/§L/§O). See findings.md "Through-line".

## 2. Per-module doc template

```
# <slug> — <Module name>
- Status: ⬜ not-run        (state machine: see sop.md §4)
- Module: <one line — the functional unit this verifies>
- Surface: <the GUI screen(s) it owns, or "owner MCP" / "backend" / "cross-origin embed">
- Real dep: <which real services/creds the substrate needs — per-module now>
- Inherits (historical finding IDs): <F-<letter>-<n> this module carries>
- Backing e2e: <the specs currently "covering" this — the attribution target>

## Checks
### 1 — <title>   (was §X-m)
- Steps: ...
- Expected: ...
- Backing test: <file:line>
- Result: ⬜
...

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
<the three lenses, concrete to THIS module's surface: renders sane · affordances live · counts agree>

## Findings   (record here during the manual phase; also log ../findings.md, historical ID F-<letter>-<n>)
```
