# StandMeet

> **Status (2026-05-16):** Mid product redefinition. Old architecture (Invitation Mode WebSocket gateway, Electron-only owner client, observer distillation engine) is being replaced. The dirs at the repo root (`standmeet-client/`, `standmeet-e2e/`, `standmeet-server/`) are **legacy reference**, not active development. New code will live in new top-level dirs to keep boundaries clear.

## What StandMeet is

A self-hostable platform for people who think a lot but don't like writing. Owner uses any AI client (Claude Desktop / Cursor / etc.) to think out loud; the AI pushes substantive insights into a personal corpus via MCP. Visitors hit the owner's page and chat with an AI that answers in the owner's voice, grounded in that corpus. Replaces the narrow representation of LinkedIn / résumé / blog.

## Product shape (canonical — supersedes any conflicting old docs)

**Self-hosted, Coolify-style.** A single instance is single-owner in v1, but every table / route carries an `owner_id` so multi-tenant comes for free later. Deployment experience is the differentiator: one command brings up the stack, Caddy/Traefik signs Let's Encrypt automatically, owner CNAMEs their domain over and it just works.

**Default outward surface = 4 web pages** (see `docs/design/project/`):

| Surface | What it is |
|---------|-----------|
| `index` | Owner's public page. Long-scroll, hero prose + chat input + insights + projects + status + contact. |
| `gate` | Visitor without a code. Code-entry block + BYOAI panel + request-access. |
| `admin` | Owner backend. 6 sections: raw / wiki / conversations / codes / connectors / page (+ api·mcp). |
| `login` | Sign in + first-run "claim this instance" flow. |

**Three visitor access tiers:**

1. **Access code** (`LABEL-XXX`, share-by-multiple, tag-scoped, with QR + suggested questions + expiry). Visitor input + identity-picker modal.
2. **BYOAI** — no code, visitor brings own API key, public slice of corpus only.
3. **Gate** — fully blocked, can request access.

**Ingest is owner-curated, not auto-distilled.** Owner's AI calls MCP write tools — `corpus.create` / `corpus.promote` / `corpus.update` / `corpus.delete`, where the genre (`raw` / `wiki` / `output`) is a **parameter**, not a separate tool; plus `writing_create` and `subjectivity_write`. The earlier "observe and distill" path (`observer/`) was tried and gave low-quality output — that direction is dead.

> Attachments / images / hero art exist for `writings` only. `upload_media` appears in older notes but was never implemented, and the `media_assets` table (with its raw/wiki/output foreign keys) has no writer. Bringing assets to every genre is planned work, not something the code already does.

**SDK.** Core capabilities (chat, content retrieval, asset rendering, access-code check) are packaged for embedding into anyone's site:
- `@standmeet/sdk` — React components + hooks
- Web Components / vanilla JS bundle — single `<script>` tag drop-in

**Custom page hosting.** Owners can write their own React page using the SDK; a sandboxed builder (the pattern in `standmeet-server/page-builder/` is the seed) builds it and hosts the static output on the instance. Owner doesn't manage deploy infra.

**Outbound side: job loop (in progress 2026-05).** StandMeet 不止 inbound visitor chat —— 也是 outbound 求职平台。完整闭环：

1. owner 在 Claude Code 问"今天 [filter] 有什么新工作" → MCP `jobs.fetch_new()` 从注册的源（Greenhouse / Lever / Ashby / RemoteOK / WWR / HN Who-is-Hiring）拉数据 → 进 **Redis 1d TTL 池子**
2. Claude 用 owner corpus + `page.where.looking_for` 排序、推荐；owner 选中的，Claude 调 `resume.draft(job_cache_id, resume_content)` curate raw+wiki+JD 写一份**草稿** PDF
3. owner 在 staging 预览看，**点头才发**；Claude `applications.commit(draft_id)` 同时 (a) 写 application 行 (b) **自动 issue AccessCode**（180d / 10 sessions / 50 turns，复用现有 access_codes 表，**AccessCode === invitation**）(c) 渲染**正式 PDF** —— layout 简单固定 ATS-friendly，**QR 印右上角**，URL = `/<handle>?code=ABC`
4. Playwright MCP（owner 本地装，跟 standmeet MCP 同挂在 Claude）填表投出去
5. recruiter 扫 PDF 右上角 QR → `/<handle>?code=ABC` → 不经 /gate → 直接进 visitor chat → AI 用 owner voice 答 → **闭环**

关键设计：**StandMeet = deterministic state holder**（fetch / dedup / 持久化 / PDF 渲染 / QR 编码 / 邀请码 issue），**Claude = reasoning + I/O**（匹配 / 排序 / 写文案 / 填表）。job 永远 ephemeral（1d TTL），application 永远持久（snapshot job_snapshot + resume_content 进表）。**LinkedIn / Wellfound / Indeed 不做 server 端 scrape**，留给未来 owner-side browser extension。

完整设计落在 `docs/design/job-loop.md` + 测试设计落在 `docs/design/job-loop-tests.md`。

**Additional surfaces (out of scope for first slice, but planned):**
- Electron client — extra owner ingest channel (clipboard, local notifications, drag-drop files, local MCP server). Shares the same backend API as web admin.
- IM bridge (Telegram / Discord / Slack) — extra ingest *and* extra visitor chat surface (visitors with an access code can chat from inside an IM).

## Design source of truth

`docs/design/` is the handoff bundle from claude.ai/design. Read `docs/design/README.md`, then `docs/design/chats/chat1.md` (the iteration transcript — that's where intent lives), then the HTML files in `docs/design/project/`.

**Design language (committed):**
- Type: Newsreader serif (body) + JetBrains Mono (metadata, labels, code).
- Palette: warm cream paper (`#F3EFE6`) + ink (`#1B1814`) + vermillion accent (`#B5391C`). Dark mode in same family.
- Anti-aesthetic: no corporate SaaS chrome (white-bg / blue-accent / rounded cards), no AI hype (sparkles, purple gradients, ✨ tags).
- Tech-vitality details: terminal scanline, corner crosshairs, ASCII sparkline, activity ticker, live-dot pulse.
- Chat is transcript flow, not alternating bubbles. Visitor Q is mono small-heading; AI answer is serif body. Sticky input dock at bottom.

The prototype is vanilla HTML + Tailwind CDN + Babel standalone. Implementations should match the visual output pixel-for-pixel but use whatever tech fits the actual codebase (Next.js etc.).

## Repository layout

```
standmeet/
├─ CLAUDE.md            ← you are here
├─ README.md            ← user-facing (currently legacy; will be rewritten)
├─ Makefile             ← legacy commands; will be replaced
├─ docs/
│  ├─ design/           ← canonical visual + product spec (read this)
│  ├─ product-vision.md ← legacy ("protocols + distillation engine" framing — superseded)
│  ├─ distillation-*.md ← legacy (observer-era thinking — direction dead)
│  ├─ growth.md         ← still useful (general traction analysis)
│  ├─ licensing.md      ← still relevant (AGPL strategy)
│  └─ protocols.md      ← legacy (four-protocol scheme not the current plan)
├─ standmeet-client/    ← legacy reference (Electron); useful for ingest-channel design
├─ standmeet-e2e/       ← legacy reference (Playwright E2E patterns to mine)
└─ standmeet-server/    ← legacy reference
   ├─ backend/          ←   Django DDD; the layering is reusable
   ├─ frontend/         ←   Next.js; useful component patterns
   ├─ gateway/          ←   WebSocket pattern dies; rewrite for 3-tier model
   ├─ im-bridge/        ←   reusable for new ingest channel
   └─ page-builder/     ←   the seed of the SDK + sandbox custom-page system
```

New work goes in new top-level dirs (names TBD — likely `backend/`, `app/`, `sdk/`, `infra/`).

## Testing (still important!)

Old wisdom that survives the redesign:

- **Test before changing code, test after. Untested feature = unfinished.** When a bug is reported, *first* write a failing test that reproduces it, *then* fix. Don't skip the test.
- **A bug is a missing-test signal.** After fixing, ask what other gaps the bug exposes, and fill those tests too.
- **End-to-end only.** No unit tests as primary coverage. Spin up real services, real connections, no mocks for external deps. Playwright drives the browser → frontend → backend in one test.
- **Tests must verify correct outcomes.** "Didn't crash" is not passing. The assistant reply must be the expected reply.
- **A test failure → read the logs first, hypothesize second.** Adding more logging is a valid step if the current logs are insufficient.
- **All test + Docker ops through Makefile.** Never bare `docker compose` or `npx playwright` — if the recipe doesn't exist, add it to Makefile first.
- **Errors must be user-friendly at the UI.** No raw stack traces, no exit codes, no technical jargon shown to the user. Fallback messages must be human readable.

## Memory

Project memory lives at `~/.claude/projects/-Users-wangsijie-Develop-projects-standmeet/memory/`. `MEMORY.md` there is the index. Read it before starting a fresh session — it carries product decisions, deprecated directions, and design rationale that aren't yet captured in code.

Key memory files (as of 2026-05-16):
- `product-redesign-2026-05.md` — the new product definition (this CLAUDE.md is the public mirror)
- `architecture-deprecations.md` — what dies, what survives, what changes
- `observer-deprecated.md` / `mcp-write-memory.md` — why automatic distillation was rejected in favor of MCP-driven curation

## Design principle: reference first

Before writing any module, ask "who has solved this already?" Find an open-source implementation and port its design intent. Coolify for self-host deployment + domain wiring. Anthropic's design system for the visual prototype. Elastic / Grafana / HashiCorp for plugin/protocol thinking (kept as background, even though the four-protocol scheme is no longer the plan).

Not blind copy-paste — read the source, understand the choice, then adapt.

## Git commits

- Never add `Co-Authored-By` lines in commit messages.
- Create new commits rather than amending unless explicitly told to.
- Don't commit `.env` files (`*.env` is in `.gitignore` — `.env.example` is fine).
