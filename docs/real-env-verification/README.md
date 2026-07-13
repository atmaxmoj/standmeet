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
