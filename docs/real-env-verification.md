# Real-environment verification guide

> **Purpose.** Every green e2e proves the code is correct *against a mock*. This guide enumerates
> **everything CI fakes** and defines the manual verification that swaps each mock for the real
> service. "Manual" = the assistant drives it via **Playwright MCP** (or a real client) against a
> **mock-free** stack where *every* dependency is real. A test passes only if the real service
> behaves as the mock promised.
>
> **Provenance.** §3 A–M is the first-pass inventory; **N–R and the nuances tagged `[scan]`
> come from a 5-agent parallel scan** (mock-stack / e2e-fixtures / config-forks /
> backend-integration / product-journeys). File:line evidence is inline. **Nothing here has been
> run against real services yet** — the checkboxes are the worklist.

---

## 1. What "mock-free" means

**Dev/e2e mock services** (`docker-compose.dev.yml`) — none may run in the real profile:

| Mock | Port | Fakes | Real replacement |
|---|---|---|---|
| `llm-gateway` | 9300 | **the LLM** — single-slot scripted queue; owner `ai_endpoint` seeded to it by `admin.ts:77 seedDevAIProvider` | real DeepSeek/OpenAI/Anthropic key |
| `external-mock` | 9000 | Google OAuth+Calendar, SendGrid, SMTP, CalDAV, generic OAuth, **11 job boards, marketplace, SSRF targets** | the actual services |
| `mail-mock` | 9400 | mail-connector upstream + SMTP fault arming | real mail connector |
| `mailpit` | 1025/8025 | test SMTP catcher | real SMTP relay + inbox |
| `mcp-server-mock` | 9100 | an external MCP server | real 3rd-party MCP server |
| `payload-origin` | 7070 | sandbox-egress target | real egress |
| captcha | — | `ProviderNone` (off) — **also off in prod by default** | Turnstile (real keys) |
| meili/minio/gotenberg | — | *real software, local/permissive dev instances* | prod-grade |

**Also deploy-config forks (§N).** Going real = drop the mock services + unset `*_BASE_URL`/`GOOGLE_*`/`MARKETPLACE_*` + supply real creds (§2) + fix/confirm §0.

**First build task:** a `docker-compose.real.yml` override (mocks removed, env repointed, real creds) — bring up `-f docker-compose.dev.yml -f docker-compose.real.yml`, claim a fresh owner, seed a small real corpus.

---

## 2. Credentials you need to provide

- **[LLM]** DeepSeek/OpenAI/Anthropic key + model → §A (the whole agent).
- **[GCAL]** Google OAuth client (id/secret, redirect whitelisted) + a throwaway Google account → §B.
- **[MAIL]** real SMTP relay creds (host/port/user/pass, STARTTLS+AUTH) **or** SendGrid key + a readable inbox → §C.
- **[MCP]** a real external MCP server URL + auth (bearer/OAuth) → §D.
- **[JOBS]** Workable company+token; others public → §E.
- **[CAPTCHA]** Turnstile site_key+secret (Cloudflare publishes always-pass/always-fail test keys) → §G.
- **[CONNECTOR]** a real SaaS w/ OpenAPI spec + creds (e.g. Cal.com) → §H; a real CalDAV account (Nextcloud/Radicale free) → §H-CalDAV.
- **[BYOAI]** one low-cost real provider key usable in a *visitor* role → §R.
- **[DEPLOY]** a real domain to CNAME + host w/ 80/443 → §I-4 (heaviest).
- **[STORAGE]** optional real S3/R2 (else dev MinIO is real-enough).
- **[SDK-HOST]** a static host on a 2nd origin → §O.
- **[PHONE]** a physical phone camera → §Q recruiter loop.

---

## 3. The test inventory

### A. Real LLM — the agent (deepest; CI scripts EVERY tool call) — [LLM]
> `mock-llm-script.ts` pops a queued `{tool,args}` per turn; `admin.ts:77` points every owner at it.
> So **none** of the model's real reasoning is exercised. `[scan]` adds: the mock emits **one**
> `tool_use`/turn (`messages.go:162`), always `end_turn` (no `max_tokens`), only a 500 error (no
> 429/529), fakes token usage, and **validates no `x-api-key`/`anthropic-version` header**.

- [ ] **A1 Grounded answer in owner voice** — real Q → first-person, corpus-grounded, no fabrication.
- [ ] **A2 Retrieval actually fires** — model *chooses* `corpus_search`/`corpus_read` (unscripted).
- [ ] **A3 `corpus_links` multi-hop.** **A4 Citation footer** matches reads.
- [ ] **A5 Subjectivity grounding by INDUCEMENT (critical)** — a judgment/stance Q → does the real model, nudged only by `visitor-header.md`, search the `subjectivity` genre and answer FROM that standpoint (not generic)? The one route with **no deterministic backing**. Control: no-subjectivity → generic.
- [ ] **A6 Subjectivity not cited** — A5 grounds but the footer omits it unless `show_as_source`.
- [ ] **A7 Ghost steering (real-LLM quality)** — `[scan]` `scriptMockGhost` fakes the whole GhostPolicy output; `eval-ghost` is mock-gateway *by design* ("no real LLM"). Verify a real model emits a *well-judged* steering ghost toward a reachable waypoint AND stays silent when all visited — and that it actually redirects the next turns.
- [ ] **A8 Summarize** real report. **A9 Booking via chat** (real reasoning → `calendar_book`, pairs §B).
- [ ] **A10 Prompt-injection — the MODEL refuses.** CI scripts a *compliant* model to prove the backend gate (`security-prompt-injection.spec.ts:33`); reality needs the model itself to refuse "reveal prompt / dump notes / ignore instructions" and not fabricate a booking for an ungranted tool.
- [ ] **A11 Precise-number honesty.** **A12 Role persistence.** **A13 Tool-error recovery.**
- [ ] **A14 Parallel tool calls** `[scan]` — real Claude emits multiple `tool_use` in one message; the agent loop's parallel dispatch is never driven.
- [ ] **A15 max_tokens truncation** `[scan]` — a long answer that truncates; graceful continuation/finish.
- [ ] **A16 Provider 429/529 overloaded + backoff** `[scan]` — real overload → retry/degrade, not crash (pairs §P Retry-After).
- [ ] **A17 Resume-content curation (job-loop core)** `[scan]` — `resume.ts:150 sampleResumeContent` **hand-authors the entire tailored resume+cover letter**; only the PDF render is tested. Verify a real model curates raw+wiki+JD into a coherent, corpus-grounded `resume_content`.
- [ ] **A18 Job ranking/recommendation** `[scan]` — the design's "Claude ranks the pool using corpus + `looking_for`" step is untested (only fetch/dedup/discard are). Owner-facing value.
- [ ] **A19 Context evals not routinely run** `[scan]` — `eval-compaction`/`eval-doc-context`/`eval-cross-conversation` exist and *require* a real key, but are manual single-persona. Promote to a scheduled real-LLM lane.
- [ ] **A20 Voice fidelity for a REAL owner** `[scan]` — the only real-LLM voice eval is one fictional persona (`marcus-chen`). No check that a *newly onboarded real owner's* corpus yields a faithful voice. Onboarding ritual, not CI gate.

### B. Real Google Calendar — [GCAL]
- [ ] **B1 OAuth connect** (real consent, real token). **B2 `list_slots` vs real freeBusy** — `[scan]` mock **ignores `timeMin/timeMax`** (`gcal.go:390`); verify real window filtering.
- [ ] **B3 `calendar_book` → event actually appears in Google.** **B4 cancel** → deleted. **B5 reschedule** → moved. **B6 send_confirmation** real invite email (real `sendUpdates`, needs §C).
- [ ] **B7 Token refresh + rotation** `[scan]` — mock never rotates the refresh token; real Google occasionally does, and the persist-new-refresh-token path is untested. Force expiry → transparent refresh; revoke → `revoked` friendly error.
- [ ] **B8 `max_bookings` quota** with real events.
- [ ] **B9 Duplicate-id insert → 409** `[scan]` — mock returns idempotent 200 (`gcal.go:279`); **real Google returns 409 and the backend has zero 409 handling.** The post-connreset "no double-book" retry that CI proves would break live. High-value.

### C. Real mail — [MAIL]
- [ ] **C1 Access-request approve → real code email lands in a real inbox** → code works.
- [ ] **C2 Recovery phrase email.** **C3 Booking confirmation.** **C4 `connectors.mail_test_send`.**
- [ ] **C5 SMTP path AND SaaS path** — `[scan]` SMTP mock advertises **no STARTTLS/AUTH** (`mail/smtp.go:53`) and never returns real reply codes (4xx greylist / 550 / 552) → error-classification untested. SendGrid mock puts message-id in the **body** not the `X-Message-Id` header and uses the wrong error shape, and checks no API key. Verify a real STARTTLS+AUTH relay AND a real SendGrid `/mail/send` (202, header id, verified sender).
- [ ] **C6 Real SMTP/SaaS auth failure** → friendly, no crash.

### D. Real external MCP server — [MCP]
- [ ] **D1 Register** a real server. **D2 Expose to a role.** **D3 dep-grant gate.**
- [ ] **D4 Real auth** `[scan]` — the mock has **no `Authorization` requirement, no SSE transport, no session lifecycle, trivial schemas**. Verify an **OAuth/bearer-gated** real MCP server, an **SSE-transport** server, and **large/complex `inputSchema`** round-trip. **D5 Real tool invocation** from visitor chat.

### E. Real job boards — [JOBS]
- [ ] **E1 `jobs.fetch_new` per source** against the real API (schema/pagination/dedup into the 1d Redis pool).
- [ ] **E2 SmartRecruiters has NO mock at all** `[scan]` — `SMARTRECRUITERS_BASE_URL` is set + adapter + fixture exist, but `job-board/main.go` serves no route → it 404s today. Real SR is a two-call N+1 (list postings → per-posting details). Verify against a real public SR company.
- [ ] **E3 Pagination** `[scan]` — **no mock paginates**; real Greenhouse/Lever/Ashby/Workday(POST-cursor)/Workable(`Link` header)/SmartRecruiters(offset)/GitHub all do. Verify a company with >100 postings consumes all pages.
- [ ] **E4 Tokened/auth sources** — Workable SPI token, BambooHR bearer (`[scan]` real path is `{slug}.bamboohr.com` subdomain, mock uses `?company=`), Workday POST-cursor. Wrong token → real upstream error, not silent empty.
- [ ] **E5 HN real N+1 + null/dead items** `[scan]` (Firebase per-item, real latency, `deleted`/`dead`).
- [ ] **E6 `resume.draft` + `applications.commit`** with a real job snapshot → real PDF + AccessCode + QR.

### F. Real marketplace — [—]
- [ ] **F1 `marketplace.search`** against real GitHub `[scan]` — mock is flat/un-paginated/un-rate-limited; real GitHub Contents is base64-per-file, paginated, 403-rate-limited, ETag-conditional; SKILL.md can be malformed/oversized. **F2 install** a real skill.
- [ ] **F3 SkillsMP is a permanent fiction** `[scan]` — `skillsmp.json` is hand-rolled; **no `api.skillsmp.com` exists.** This source can never be verified against reality; flag it, don't chase it.

### G. Real captcha — [CAPTCHA]
- [ ] **G1 Turnstile siteverify actually called** `[scan]` — dev/e2e run the **noop** verifier; `turnstile.go:28` hardcodes the real siteverify URL (not env-overridable). Verify: valid widget token unlocks; **replayed/consumed** token rejected (single-use); forged token rejected; real `error-codes` shape + `remoteip`. G2 code-guard `/gate`. G3 access-request. G4 **login** Turnstile (still `[ ]`).

### H. Real connector (OpenAPI/protocol/OAuth/CalDAV) — [CONNECTOR]
- [ ] **H1 Upload a real vendor OpenAPI** (e.g. Cal.com) + binding `[scan]` — CI only ever assembles hand-written specs against `external-mock`. **H2 real OAuth2 dance** — `[scan]` mock **validates no client_secret/code/PKCE/redirect_uri and never rotates refresh** (`gcal.go:172`). **H3 real proxied call.** **H4 credential at-rest** AAD-bound, never in transcript/logs.
- [ ] **H5 SSRF BLOCK path (never runs in CI)** `[scan]` — `CONNECTOR_EGRESS_ALLOW=external-mock` whitelists the mock host, so `safeDialAddr` (`connector/egress.go:104`) **never actually blocks**. Verify against a host that resolves public then flips to `169.254.x`/`127.x`/IPv6-private (DNS-rebinding), and a redirect landing on a private IP → `ErrBlockedEgress`.
- [ ] **H6 Real CalDAV connector** `[scan]` — mock has **no auth, ignores REPORT filters, no RRULE/VTIMEZONE expansion, always-207 PROPFIND** (`caldav.go:63`). Verify booker against real Fastmail/Nextcloud/Radicale with a **recurring** event.

### I. Storage / PDF / deploy — [STORAGE][DEPLOY]
- [ ] **I1 `upload_media` → real object store** → presigned URL renders (dev MinIO is real-enough; optional real S3/R2). Note `STORAGE_USE_SSL=false` even in prod compose `[scan]`.
- [ ] **I2 Resume/report PDF** via real gotenberg + real print view; QR resolves. `[scan]` dev gotenberg is **permissive** (`--chromium-deny-list=` off, JS on); verify a **hardened prod** Chromium posture (deny-list, fonts, network-idle, SSL).
- [ ] **I3 Custom-page sandbox build** → real static hosting (covered by K; real Vite build in bwrap).
- [ ] **I4 Real domain + Let's Encrypt TLS** — CNAME a real domain, `/internal/tls-ask` gates, cert auto-signs, `https://<domain>` serves. `[scan]` real ACME/DNS is **provider territory** (roadmap 块三 cut) — so "CNAME and it just works" has no owner-journey by decision; name it so it isn't assumed. **(heaviest; [DEPLOY])**

### J. API-key facade — mostly deterministic — [—]
- [ ] **J1 Real corpus dispatch** — mint key, `api.open corpus.retrieval`, `QUERY corpus_search` over **real corpus content** → real hits, role-scoped. **J2 Real rate limit under load** → 429 + per-key isolation. **J3 Real booking via key** (with §B). **J4 No-leak** vs `/api/admin/*` + `/mcp` live.

### K. Sandbox egress — [—]
- [ ] **K1 AllowNet vs default-deny** — real external URL reached with net access; `--network=none` blocked. **K2 sandbox under prod isolation** — prod uses the docker-driver (sibling containers via docker.sock), not bwrap-in-backend; verify a sandbox skill runs on the prod stack. **K3 real cron fires on schedule** `[scan]` — the workspace/resume-draft sweeps are only ever run on-demand via a diag hook; verify the real scheduler.

### L. Obsidian vault — sync + render (pillar 1; CI = synthetic fixture vault) — [—]
> Use the **real** vault `~/Develop/writing/notes` (hundreds of real notes, real `.obsidian/`, real
> math/diagrams) — where tolerant-parse / reconcile / render break as a clean fixture never shows.

- [ ] **L1 Classify at real scale** — folders → correct genres, nothing dropped/mis-routed.
- [ ] **L2 Tolerant frontmatter on REAL notes** — messy/partial/exotic fm all parse (first to break).
- [ ] **L3 Node-tree + folder-note collapse + auto-node tolerance** on real nesting.
- [ ] **L4 Reconcile + idempotent re-sync + move/rename** (rename orphans by design; `normalize-names` repoints).
- [ ] **L5 Wikilink graph** — real `[[Title]]` cross-genre, `![[embed]]`, `#heading`, code fences; backlinks (`corpus_links`) over real `note_refs`; the real `check-links.sh` contract.
- [ ] **L6 Real attachments/images** → object store, `cover_image` inlined, canonicalExt.
- [ ] **L7 CSS snippet harvest** from the real `.obsidian/snippets/*.css` (sanitize+scope). **L8 `cssclasses`.** **L9 hidden-file harvest** (`.obsidian/` config harvested, not skipped).
- [ ] **L10 Render face on REAL content** — real KaTeX/Mermaid/TikZ/callouts/`standmeet-query`/`standmeet-html`/widget in the vault (the math/orbit notes have real math); no ENOENT/hang, no sanitize-strip.
- [ ] **L11 Export round-trip.** **L12 web-wins conflict.** **L13 scale/perf + real `corpus_search` relevance** (CJK+EN; degrade-to-PG-FTS). **L14 `.scripts` contract alignment** (vault's actual scripts vs parser assumptions).

### M. Real MCP client (owner's ingest workflow) — [—]
- [ ] **M1 Real client connect** — Claude Desktop/Cursor → `/mcp` → `tools/list` sees all 125 tools (over the real client's transport/signing; the stdio SDK had a Sigv1 bug — `c3-stdio-sdk-sigv1-401`). **M2 Real ingest turn** ("remember this…" → `raw_dump`/`promote_to_wiki`/`subjectivity_write` land). **M3 api_keys.create/api.open via real client.**

### N. Prod deploy-config forks — [DEPLOY]
- [ ] **N1 `STANDMEET_PLUGINS` unset in prod** `[scan]` → no 3rd-party MCP-app plugins load; verify a real owner-registered plugin loads in prod. **N2 `SANDBOX_WORKSPACE_ROOT`** default writable as uid 1001. **N3 `AGENT_TURN_TIMEOUT`** 120s prod default; short-timeout error path only seen in e2e. **N4 `TURNSTILE_*` unset in BOTH composes** — captcha off by default in prod (permissive default the owner must opt into). **N5 `STORAGE_PUBLIC_URL`/`STORAGE_USE_SSL`** prod values.

### O. SDK / web-components embed — ZERO coverage — [SDK-HOST]
> `[scan]` **biggest single-surface gap.** `sdk/packages/{embed,react,core,agent-core,mcp-client}`
> is a **shipped, customer-facing** deliverable (CLAUDE.md) with **no tests of any kind**, and the
> app does **not** dogfood it (`app/src` has its own `agent-turn` copy).
- [ ] **O1 `embed.global.js` on a bare non-Next page on a DIFFERENT origin** → CORS (the backend currently emits no `Access-Control-*` headers — verify cross-origin), session bootstrap, SSE streaming, access-code redemption, real-LLM answer render.
- [ ] **O2 `@standmeet/react` in a vanilla Vite host** (not Next) → same.
- [ ] **O3 Web-Components single-`<script>` drop-in** → renders + chats.

### P. Cross-cutting live-only failure modes (affect A–M) — [—]
- [ ] **P1 `Retry-After` ignored** `[scan]` — `httpx/retry_transport.go:78` retries 429/5xx with fixed backoff, **never honoring `Retry-After`** → on a real rate-limited provider it retries too early and can worsen a ban. **No mock sends 429/Retry-After.** Front a real integration with `429 Retry-After: 30`, assert it waits.
- [ ] **P2 OAuth silent refresh + `invalid_grant`** race/expiry/skew (§B7, §H2) on a real provider.
- [ ] **P3 Envelope decrypt + `INSTANCE_SECRET` rotation** `[scan]` — rotate the secret against a DB of encrypted connector creds → friendly "reconnect required", not a decrypt panic (AAD mismatch).
- [ ] **P4 Redis TTL eviction under memory pressure** `[scan]` — memory-capped Redis + `maxmemory-policy`, fill the 1d job pool → graceful on eviction; bounce Redis → sessions/rate-limit recover.
- [ ] **P5 Meili version drift + `WaitForTask` latency at scale** `[scan]` — index a few-thousand-doc corpus on a pinned prod meili; write-then-search consistency + latency; kill meili → clean PG fallback.
- [ ] **P6 Inference `/v1/models` discovery** `[scan]` — the admin/BYOAI model picker hits a **different** endpoint (`inference_models.go:147`) than chat; real key-scope (can chat, can't list), 429, sanitized error (don't echo raw upstream body).

### Q. Product closed-loop journeys (segments covered; the LOOP isn't) — [PHONE][LLM]
- [ ] **Q1 Recruiter physical closed loop** `[scan]` — render the real `applications.commit` PDF (real gotenberg) → **scan the QR with a real phone camera** → `/{handle}?code=` skips /gate → ChatRoom → **real-LLM owner-voice answer**. Today the "scan" is `page.goto('/?code=…')` and the answer is scripted. The outbound thesis, never walked with real actors.
- [ ] **Q2 Access-request → approve → email-with-code → redeem** — one continuous journey (mail real via §C; no test walks the whole thing).
- [ ] **Q3 Ingest→answer feedback loop** — owner adds a corpus note via real MCP → the *next real-LLM visitor turn* grounds on it.

### R. BYOAI against a REAL external provider — [BYOAI]
- [ ] **R1** `[scan]` — `byoai-chat.spec.ts` **pins the endpoint at the mock** ("would 401 a fake key"), so the whole BYOAI value prop — backend calling the **visitor's real third-party provider** with an HKDF-encrypted key, public-slice ACL enforced on a real model — is never run. Issue a gate BYOAI session with a real low-cost key against the real provider endpoint; assert a real streamed answer AND that private corpus stays excluded.

---

## 4. Priority

The two deepest mock-vs-real gaps, both needing only [LLM] + assets we have:
1. **§L (real Obsidian vault)** — pillar 1; L2/L10 break first on real data. No external cred.
2. **§A (real LLM)** — every agent behavior CI scripts; **A5, A10, A17 (resume curation), A7 (ghost quality)** have no deterministic backing.

Then:
3. **§O (SDK embed)** — a shipped surface with *zero* coverage; cheap to start once a 2nd origin is up.
4. **§M (real MCP client)** + **§R (BYOAI real provider)** + **§Q (product loops)** — product-central, mostly cheap.
5. **§P (cross-cutting live-only: Retry-After, SSRF-block, envelope-rotation, Redis eviction)** — infra failure modes no mock exercises; several are latent bugs.
6. **§B/§C (calendar+mail)**, then **§H/§D (connector/MCP OAuth, CalDAV)**, **§G (captcha)**, **§E/§F (job boards, marketplace)**.
7. **§I-4 (real domain/TLS)** — heaviest; the deploy story.

## 5. First build task
`docker-compose.real.yml` override: drop `llm-gateway`/`external-mock`/`mail-mock`/`mcp-server-mock`/
`payload-origin`; unset the mock `*_BASE_URL`/`GOOGLE_*`/`MARKETPLACE_*`; add real-cred env as it
arrives; confirm the prod-ish stack builds + sandboxes. Claim a fresh owner,
seed a small real corpus (raw→wiki, a subjectivity note, one output) for §A/§J/§L.
