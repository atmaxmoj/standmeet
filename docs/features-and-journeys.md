# StandMeet — Features & User Journeys

> 这份文档是 test backlog 的源头。先 enumerate 功能跟 journey，再基于这个补测试。
> 每条 case / journey 后面标 [✓ spec] 表示已覆盖，[~ spec] 部分覆盖，[ ] 未覆盖。
> 维护规则：动了 product surface → 同步改这里；写新 e2e → 把 [ ] 翻成 [✓ spec-name]。

---

## 1. Feature inventory（按 surface）

### 1.1 公开页 surfaces

#### `/` — Owner public page (single-owner v1)

**Long-scroll mode**（public visitor，没 session）：
- TopBar: handle / dark toggle [✓ public-page]
- Hero（identity strip + serif prose + chat 输入 dock + examples）[✓ public-page]
- QuickAskDeck（≥6 examples 时渲 3-col numbered question grid，asked 的 line-through）[✓ public-page]
- Quota lockdown（used >= max → input 禁用 + "session full · request more"）[✓ session-strip]
- `?q=` URL 消费（blog AskAboutThis / starter 跳过来自动喂 chat）[✓ ask-about-this]
- Conversation Deck（多 turn 历史 + reset + citations + ToolCallBlock）[✓ visitor-chat-*]
- Insights（owner 最近 wiki/output 卡，expandable body）[✓ public-page]
- Projects（curated 工作样本，typography only）[✓ page-edit-full]
- Where（looking-for status + filter list）[✓ page-edit-full]
- Contact（email / jump-to-chat / recruiter rules / casual rules）[✓ page-edit-full]
- Footer（entries count + updated + grounded retrieval 提示）[✓ public-page]

**ChatRoom mode**（coded / BYOAI visitor，有 session）：
- SessionStrip（sticky 顶条：code 标签 + gauge + BYOAI 紫 + warn + exit）[✓ session-strip]
- VisitorNamePicker modal（首次 chat 问名字，30d dismiss）[✓ visitor-name-picker]
- ChatRoom slim header（standmeet / handle / live dot + reset + "full page →"）[✓ gate-access, byoai-chat]
- ChatWelcome（coded: "Hi, {name}. Scoped to {label}." / BYOAI: "public slice only"）[✓ gate-access, byoai-chat]
- ChatComposer（sticky bottom input + starter chips + ask ↵ / session full）[✓ gate-access, byoai-chat]
- ChatTranscript（Turn: question + AI answer + ToolCallBlock）[✓ byoai-chat]
- ChatFootnote（"how this works" explainer）[✓ byoai-chat]
- ToolCallBlock（calendar slots / booking / image / file structured renders）[✓ 内置]

#### `/gate` — 三档入口面板
- Code panel（输 code + visitor name → POST /v1/sessions）[✓ access-codes, gate-access]
  - v5 polish: 大写归一 + paste 自动 submit + 错码 shake + "checking…" / "unknown code" 状态 [✓ gate-access]
  - session response 返 members[] + code_label（backend 已加）[✓ 内置]
- BYOAI panel（provider preset + endpoint + model + key 4 项必填）[✓ byoai-chat]
- Request access form（email / name / org / message）[✓ gate-access]
- "what's behind" 解释段 [✓ gate-access]

#### `/blog` — Blog index
- Cover card grid（amber / violet / acid hue + headline + excerpt + tags）[✓ blog-posts]
- Tag filter chips [✓ blog-posts]
- Infinite scroll（12/page，cursor 分页）[✓ blog-posts]
- "or skip the reading · Ask the AI directly" CTA（文末跳 / chat）[✓ ask-about-this]
- RecommendedRail（"if you only read two" + 前 2 篇推荐）[✓ 内置]
- SessionStrip [✓ session-strip]
- FloatingChatDock（右下角浮动 chat 面板，不离页 chat）[✓ 内置]

#### `/blog/<slug>` — Blog article
- Cover section [✓ blog-posts]
- ArticleHeader（title + meta + tags）[✓ blog-posts]
- GFM body 渲染（h2/h3/bold/italic/list/table/code/quote/img/checklist）[✓ blog-posts]
- 内联图（`standmeet-asset:<id>` → presigned URL）[✓ blog-posts]
- `[[crosslink]]` render-time rewrite [✓ blog-crosslinks]
- Backlinks aside（"linked from"）[✓ blog-crosslinks]
- AskAboutThis（文末 follow-up 输入条 + starter prompts → `/?q=...`）[✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [✓ 内置]
- LockedView（private post + 没 code → teaser + request CTA）[ ]
- XSS escape [✓ blog-posts]

#### `/wiki/<slug>` — Wiki SEO landing
- SEO og 标 + canonical [✓ wiki-landing]
- Cover hero（typographic OG-style header）[✓ 内置]
- Body 渲（plain text + 链接）[✓ wiki-landing]
- Breadcrumb（writing / wiki · slug）[✓ wiki-landing]
- TrustBox（about this entry）[✓ wiki-landing]
- AskAboutThis（kind=wiki）[✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [✓ 内置]
- LockedView（private entry → "requires an access code" + gate link）[✓ 内置]

#### `/output/<slug>` — Output SEO landing
- Cover hero（typographic + format tag）[✓ 内置]
- PDF preview card（8.5×11 aspect-ratio placeholder）[✓ 内置]
- Breadcrumb（writing / output · slug）[✓ output-landing]
- TrustBox（about this piece）[✓ output-landing]
- AskAboutThis（kind=output）[✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [✓ 内置]
- LockedView（gated output → "requires an access code"）[✓ 内置]

#### `/p/<slug>` — Custom React 页（owner 自写，SDK 嵌）
- Vite-built React 页 [✓ microsite]
- 静态资源直 serve [✓ microsite]
- Rollback 到上版 build [ ]

### 1.2 Auth + setup surfaces

#### `/setup?t=<token>` — 首次 claim（4-step wizard）
- Step 1 Identity: name / handle / publicUrl [✓ claim-instance, setup-wizard-4step]
- Step 2 Credentials: email / password / confirm [✓ claim-instance, setup-wizard-4step]
- Step 3 AI Provider: provider chip + key + model（可跳过）[✓ setup-wizard-4step]
- Step 4 Verify: arithmetic captcha + summary 卡 → submit [✓ setup-wizard-4step]
- Step progress bar（4 段 + 文案）[✓ setup-wizard-4step]
- PrimaryBtn realtime disable（step 必填未满 → 按钮灰）[✓ setup-wizard-4step]
- 错 captcha 拒绝 [✓ setup-wizard-4step]
- 密码不匹配 error [✓ setup-wizard-4step]

#### `/login` — Owner login
- Email + password [✓ owner-login]
- Turnstile captcha（toggle on）[ ]
- "forgot password" link [✓ password-reset]
- 登录失败 throttle [ ]

#### `/account/reset?t=<token>` — Password reset
- 输新 password → reset [✓ password-reset]

### 1.3 Admin backend (`/admin`)

#### Sidebar
- 6-group NAV_GROUPS（overview / corpus / access / jobs / integrations / settings）[✓ admin-auth-guards]
- mono 11.5px nav-links + "── group" headers + border-left accent active [✓ admin-auth-guards]
- Dynamic badges（raw unprocessed / requests new / listings shortlist）[✓ 内置]
- testid-based nav links（admin-nav-<slug>）[✓ admin-auth-guards]

#### Dashboard（/admin/dashboard）
- 4 KPI cards with trend arrows [✓ admin-auth-guards]
- Corpus pulse SVG sparkline (14d) [✓ 内置]
- Jobs heat card（shortlist / sent / top match）[✓ 内置]
- Recent visitors table（top 5 conversations with name / code / turns / priv hits）[✓ 内置]
- "needs your hand" action list（requests + raw + resume drafts pending）[✓ 内置]

#### Raw
- list + 4-tab status filter (all/unprocessed/flagged-private/promoted) [✓ corpus-crud-ui]
- DumpBox（source picker chips + textarea + "attach media" button）[✓ 内置]
- 每行 media metadata（kind · label）[✓ 内置]
- 编辑 body / tags / source / private-hint [✓ corpus-crud-ui]
- delete / archive [✓ corpus-crud-ui]
- promote_to_wiki modal [✓ corpus-curation]

#### Wiki
- tag-chip filter 行 + 2-col grid card [✓ corpus-crud-ui]
- excerpt 段落（backend 从 Body 截前 200 字符）[✓ 内置]
- ● public/private visibility dot [✓ 内置]
- create / edit / delete [✓ corpus-crud-ui]
- SEO 编辑（seo_slug / seo_description / indexed / og_image）[~ seo-feeds]
- promote_to_output [✓ output-promotion]
- view live ↗ link [✓ wiki-landing]

#### Outputs
- 2-col card grid（cover strip with hue gradient + tier pill + format tag）[✓ output-promotion]
- views / downloads stats row [✓ 内置]
- dual create buttons（+ pdf lead-magnet / + web essay）[✓ 内置]
- create / edit / delete [✓ output-promotion]
- tier 推导（seo_indexed + show_as_source → public/unlisted/private）[✓ 内置]

#### Conversations
- table（visitor / via code / turns / sentiment / flags / last）[✓ conversations-per-code]
- sentiment 列（backend DeriveSentiment heuristic: engaged/warm/curious/short/probing/shopping）[✓ 内置]
- private-hits flag 列 [✓ 内置]
- transcript 展开 + cited bodies [✓ conversations-per-code]

#### Codes
- create modal（label / corpus_permissions / quotas / suggested_questions / skills）[✓ access-codes, code-quotas]
- 2-col card grid with 3-col body layout（members | scope | inline QR）[✓ access-codes]
- Quota visual bar [✓ 内置]
- "M active · N total" 计数 [✓ access-codes]
- members 列（谁用过）[✓ member-quotas]

#### Access Requests
- list + filter chips（open / replied / closed / all）[✓ gate-access]
- blockquote message display [✓ 内置]
- approve · issue code → / decline politely / defer · pending / block sender 按钮 [✓ 内置]

#### Drafts（/admin/drafts）
- GET /api/admin/drafts/ 真 fetch [✓ drafts-composer]
- draft card（2-col: content + 200px PDF preview thumbnail）[✓ 内置]
- status Pill（reviewing / draft / sent）[✓ 内置]
- diff-vs-master 引用块（accent left border）[✓ 内置]
- action buttons vary by status [✓ 内置]
- "open composer →" → ResumeComposer 全屏 overlay [✓ 内置]

#### Applications（/admin/applications）
- GET /api/admin/applications/ 真 fetch [✓ applications-detail-modal]
- application card with 3-col footer（contact / notes / "open ›"）[✓ 内置]
- ApplicationDetailModal（timeline + contact + notes + snapshot + status segmented）[✓ 内置]

#### Connectors
- 2-col grid + dashed "＋ browse the catalog" 占位卡 [✓ connector-add-modal]
- ConnectorAddModal（5 category tabs + 18 entry catalog grid）[✓ connector-add-modal]
- ConnectorConfigForm（按 fields[] 动态渲 string/select/secret/oauth）[✓ connector-add-modal]

#### API · MCP
- AI provider config [✓ ai-provider-config]
- API token CRUD + MaskedSecret [✓ api-tokens]
- MCP setup tabs（Claude Desktop / Cursor / HTTP with code snippets）[✓ api-tokens]
- MCP install packages grid（npm / macOS / Linux / Windows）[✓ api-tokens]
- External MCP server CRUD + test [✓ external-mcp-tools]

#### Posts / Writing (blog admin)
- inline split-pane editor（1.6fr editor + 1fr EditorSideRail）when editing [✓ blog-posts]
- Tiptap editor + slash menu [✓ blog-posts]
- `[[crosslink]]` autocomplete（CrosslinkCommand + CrosslinkPicker）[✓ 内置]
- EditorSideRail（crosslinks panel + keyboard shortcuts card）[✓ 内置]
- cover headline / sub / hue / cover image upload [✓ blog-posts]
- paste image → MinIO upload [✓ blog-posts]
- "N posts · M drafts" 计数 [✓ 内置]
- edit existing post [✓ blog-posts]

#### Microsites
- table 视图（page / template / visibility / views / updated / actions）[✓ microsite]
- "+ new page" header action [✓ 内置]
- "templates available" 4-cell grid（press-kit / list-with-prose / menu / auto-now）[✓ microsite]
- 编辑器 + build [✓ microsite]
- staging preview → promote live [✓ microsite]
- rollback [ ]

#### Skills
- corpus-inferred heat graph（2-col grid, heat-bar gradient + role labels: core/strong/maintained/developing/dormant）[✓ 内置]
- "rebuild from corpus" button [✓ 内置]
- AI-persona skill CRUD cards（name + prompt + scripts）[✓ skills]
- 绑 code [✓ skills]

#### Preview（/admin/preview）
- code picker sidebar（每张 code 卡 + BYOAI card）[✓ 内置]
- simulated visitor view（banner + welcome prose + suggested questions）[✓ 内置]

#### Sources（/admin/sources）
- intro + empty state [✓ 内置]
- table with full data rows（需后续 admin REST endpoint 接通）[ ]

#### Listings（/admin/listings）
- intro + empty state [✓ 内置]
- table + match-bar + filter tabs（需后续 admin REST endpoint 接通）[ ]

#### Page customization（/admin/page）
- 7 block rows（hero / insights / projects / where / contact / site / byoai）[✓ page-edit-full]
- handle 编辑 [✓ page-edit, public-url-edit]
- Save / dirty state [✓ page-edit]

#### Account
- 4-card grid（profile + security + inference + data/backups）[✓ account-edit]
- profile: full name + email editing [✓ account-edit]
- security: password change + 2FA/recovery phrase placeholders [✓ 内置]
- inference: provider + 30d spend [✓ 内置]
- data: storage + backup now + export corpus [✓ 内置]

#### SEO（/admin/seo）
- defaults form（site title / description / twitter / canonical / robots）[✓ 内置]
- indexing stats（pages / outputs / posts）[✓ 内置]
- OG cover preview + upload [✓ 内置]

#### Obsidian（/admin/obsidian）
- vault stats（mode / notes / size / last sync）[✓ 内置]
- import / export actions [✓ obsidian-sync]
- recent events log [✓ 内置]

#### System（/admin/system）
- terminal deployment block（version / node / uptime / migrations）[✓ 内置]
- resources KPIs（cpu / memory）[✓ 内置]
- background jobs table [✓ 内置]
- health checks grid（status dots + details）[✓ 内置]

### 1.4 MCP server tools

#### Corpus
- raw_dump / list_recent_raw / promote_to_wiki / list_recent_wiki [~ corpus-curation]

#### Posts
- post_create [✓ blog-posts]
- post_list / post_publish / post_delete [~ blog-crosslinks]

#### Wiki / Output / SEO
- promote_wiki_to_output / list_output [✓ output-promotion]
- set_wiki_slug / seo.update_settings [~ seo-feeds]

#### Skills
- skill_create / skill_list / skill_delete [✓ skills]

#### Jobs (outbound 闭环左半)
- jobs.register_source / list_sources / unregister_source [✓ job-sources-register]
- jobs.fetch_new（8 个 adapter）[✓ job-fetch-multi-source]
- jobs.show / discard [✓ job-discard]
- TTL eviction [✓ job-fetch-ttl-eviction]
- 去重 [✓ job-fetch-deduplicates]

#### Resume + applications
- resume.draft / update_draft / discard_draft [✓ resume-draft-preview, resume-draft-update, resume-draft-discard, resume-draft-ttl]
- applications.commit（写行 + auto AccessCode + 渲 PDF + QR）[✓ applications-commit, applications-commit-qr-works, applications-commit-playwright-hint]

#### Microsites
- create / list / delete / write_file / build_page / get_build / promote / rollback [✓ mcp-page-lifecycle]

#### MCP servers
- mcp_server.create / list / delete [✓ external-mcp-tools]

#### Debug / metadata
- chat.show_grounding [✓ mcp-show-grounding]
- me [ ]

#### MCP auth
- bearer token gating（owner / job / skill）[✓ mcp-auth, mcp-jobs-auth]

### 1.5 Inference / chat 引擎
- SSE streaming [✓ visitor-chat-*]
- 源 citation（wiki / output 引用 reveal）[✓ visitor-chat-cited-precise, visitor-chat-cites-output, visitor-chat-hidden-source]
- corpus_permissions ACL（allow / deny first-match-wins）[✓ visitor-chat-permissions-deny]
- BYOAI 公开切片限制 [✓ visitor-chat-byoai-public-only]
- visitor summary [✓ visitor-summary]
- ToolCallBlock 结构化渲染（calendar / booking / image / file）[✓ 内置]
- tier 切换 fallback（code 用尽 → public）[ ]

### 1.6 Quota system
- per-code max_sessions / max_turns_per_session / TTL [✓ code-quotas, turn-quota, quota-accumulation]
- per-member quota [✓ member-quotas]
- exceeded → 拒 + SessionStrip warn + AskInput/ChatComposer lockdown [✓ code-quotas, session-strip]
- code self-test（owner 预览 visitor 体验）[✓ code-self-test]

### 1.7 Asset management
- MinIO blob lifecycle（CREATE = tx commit → upload；DELETE = list + delete blobs）[~ blog-posts]
- presigned URL [✓ blog-posts]
- holder_id NOT NULL（no orphan）[ ]
- orphan sweep（即使有也跑得动）[ ]

### 1.8 SEO + feeds
- robots.txt + sitemap.xml [✓ seo-feeds]
- og: 标（root / blog / wiki / output）[~ seo-feeds]
- canonical URL [ ]
- RSS feed（blog posts）[ ]

### 1.9 Visitor session
- session 落 localStorage（standmeet-session via zustand store）[✓ qr-code-absorb, session-strip]
- SessionStrip（跨 surface sticky 顶条 + gauge + warn）[✓ session-strip]
- ChatRoom（coded/BYOAI visitor focused layout 自动切换）[✓ gate-access, byoai-chat]
- conversation continuity（同 visitor 同 session）[✓ visitor-chat-*]
- visitor name picker 模态首次 chat [✓ visitor-name-picker]
- 多 tab 共享 session（cross-tab storage event sync）[✓ session-strip]
- FloatingChatDock（blog/wiki/output 浮动 chat 面板）[✓ 内置]

### 1.10 Design system
- sm-tokens.css（11 色 + serif/mono + tracking + motion）[✓ 内置]
- sm-atoms.css（session strip / visitor name picker / crosslink picker / composer / connector modal / floating chat 等 22+ atom 类）[✓ 内置]
- sm-mobile.css（≤720/900/1024 断点响应式）[✓ 内置]
- SVG Sparkline 组件（polyline + area fill）[✓ 内置]
- .shake keyframe（gate 错码抖动）[✓ gate-access]

### 1.11 System / infra
- sysroutes: TLS ask / builder webhooks / health [ ]
- captcha verifier（Turnstile / noop）[ ]
- reset endpoint（e2e teardown 用）[✓ 间接]

---

## 2. User journeys

### 2.A Owner journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| A1 | 首次部署 + 4-step claim | `docker compose up` → `/setup?t=...` → identity → credentials → AI provider（可跳）→ captcha verify → `/admin` | [✓ claim-instance, setup-wizard-4step] |
| A2 | 登录 | `/login` → cookie → `/admin` | [✓ owner-login] |
| A3 | 忘密码 | `/login` → forgot → email → `/account/reset?t=...` → 新密 | [✓ password-reset] |
| A4 | 配 server-side AI provider | `/admin/api-mcp` → provider + key → test → save | [✓ ai-provider-config] |
| A5 | 装 MCP client + bind Claude Desktop | API token → MCP setup tab → copy snippet → paste to config | [✓ api-tokens] |
| A6 | MCP raw_dump 喂 raw | Claude → raw_dump → `/admin/raw` 看到 | [~ corpus-curation] |
| A7 | 把 raw 升 wiki | MCP promote_to_wiki / admin UI promote modal | [✓ corpus-curation] |
| A8 | wiki 升 output | promote_wiki_to_output | [✓ output-promotion] |
| A9 | admin UI 写博客（inline editor + side rail） | new post → inline split-pane editor → / for slash menu → [[ for crosslink → side rail shows crosslinks + keyboard hints | [✓ blog-posts] |
| A10 | MCP post_create 写博客 | post_create(GFM markdown, publish=true) | [✓ blog-posts] |
| A11 | publish / unpublish / delete post | admin UI 行操作 | [ ] |
| A12 | Obsidian vault sync (feed face) | `/admin/obsidian` upload whole vault → `SyncVault`: top-folder→genre routing (wiki/subjectivity/raw/writing) · folder nesting→`parent_id` node tree · folder-note collapse (`foo/foo.md`) · tolerant frontmatter · whole-batch `[[link]]`→`note_refs` · web-wins guard; reverse export→zip | [✓ sync-a-routing · -b-tree · -c-title · -d-publish · -e-links · -f-frontmatter · -g-hidden · -h-reconcile · -i-raw · -j-export] |
| A13 | 改 public page 区块 | `/admin/page` → hero/projects/where/contact/site/byoai | [✓ page-edit, page-edit-full] |
| A14 | 接 custom domain | `/admin/page` → domain → CNAME | [ ] |
| A15 | 写 custom React 页 | microsite.create → write_file → build → promote | [✓ mcp-page-lifecycle, microsite] |
| A16 | 接外部 MCP server | `/admin/api-mcp` MCP servers add | [✓ external-mcp-tools] |
| A17 | 手动签 access code | `/admin/codes` new code + 配额 + suggested Q | [✓ access-codes, code-quotas] |
| A18 | 审批 access request → auto code | `/admin/requests` → approve · issue code → | [ ] |
| A19 | 翻 conversations + sentiment | `/admin/conversations` table with sentiment column + transcript | [✓ conversations-per-code, mcp-show-grounding] |
| A20 | Skills 创建 + heat graph | new skill + heat-bar visualization | [✓ skills, skill-scripts] |
| A21 | account 编辑 | `/admin/account` → 4-card grid: profile / security / inference / data | [✓ account-edit] |
| A22 | 注册 job source | jobs.register_source(kind, config) | [✓ job-sources-register] |
| A23 | 拉新工作 + dedup + TTL | jobs.fetch_new → Redis 1d 池 | [✓ job-fetch-multi-source, -deduplicates, -ttl-eviction] |
| A24 | 起 resume draft + iterate | resume.draft / update_draft / discard_draft | [✓ resume-draft-*] |
| A25 | 投 application（闭环关键） | applications.commit → 写行 + auto code + PDF + QR | [✓ applications-commit, -qr-works, -playwright-hint] |
| A26 | SEO 全局设置 | `/admin/seo` → defaults form + indexing stats + og preview | [~ seo-feeds] |
| A27 | 添加 connector | `/admin/connectors` → dashed "+" card / header button → ConnectorAddModal → category tabs → config form → connect | [✓ connector-add-modal] |
| A28 | 看 dashboard | `/admin/dashboard` → 4 KPI + sparkline + jobs heat + recent visitors + needs-your-hand | [✓ admin-auth-guards] |
| A29 | 看 drafts + open composer | `/admin/drafts` → draft card (PDF preview + status pill + diff) → "open composer →" → 6 panel + preview | [~ drafts-composer] |
| A30 | 看 applications | `/admin/applications` → card (3-col footer) → detail modal → status / notes | [~ applications-detail-modal] |
| A31 | Preview as visitor | `/admin/preview` → pick code / BYOAI → see simulated visitor view with banner + welcome + suggested questions | [✓ 内置] |
| A32 | 看 system info | `/admin/system` → terminal deploy block + resources + jobs + health checks | [✓ 内置] |
| A33 | corpus as a living graph (crawl face) | any corpus note → cited-by / related via `corpus_links` (1-hop over `note_refs`, every neighbor re-ACL'd) — the vault's backlink graph, agent-drivable | [✓ retrieval-links] |

### 2.B Visitor journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| B1 | 扫 QR（recruiter 主入口） | `/?code=ABC` → absorb → URL 清 → ChatRoom（focused layout） | [✓ qr-code-absorb, session-strip] |
| B2 | 手动输 code（paste 自动 submit） | `/gate` code panel → paste → shake on error → submit → ChatRoom | [✓ gate-access, access-codes] |
| B3 | BYOAI 配 provider+key 走 chat | `/gate` BYOAI panel → vault 加密 → ChatRoom（BYOAI mode） | [✓ byoai-chat, visitor-chat-byoai-public-only, session-strip] |
| B4 | 没 code 申请 access | `/gate` request form | [✓ gate-access] |
| B5 | ChatRoom 一轮 chat + starter chips | ChatComposer → "try" starter → SSE → Turn with citations | [✓ visitor-chat-cited-precise, -cites-output, -hidden-source] |
| B6 | 看 long-scroll（public visitor） | root scroll: Hero → QuickAskDeck → Insights → Projects → Where → Contact → Footer | [✓ public-page] |
| B7 | 浏览 blog 列表 + CTA + recommend | `/blog` infinite scroll → CTA → "if you only read two" | [✓ blog-posts, ask-about-this] |
| B8 | 看 public 博客 + crosslink + AskAboutThis | `/blog/<slug>` GFM + `[[X]]` + linked-from + 文末 follow-up | [✓ blog-posts, blog-crosslinks, ask-about-this] |
| B9 | 看 private 博客 → LockedView | `/blog/<private>` 没 code | [ ] |
| B10 | wiki SEO landing + cover hero + trust box | `/wiki/<slug>` cover hero + breadcrumb + TrustBox + AskAboutThis | [✓ wiki-landing, ask-about-this] |
| B11 | output landing + hero + PDF preview | `/output/<slug>` hero + PDF preview card + TrustBox + AskAboutThis | [✓ output-landing, ask-about-this] |
| B12 | 看 microsite | `/p/<slug>` | [✓ microsite] |
| B13 | quota 用尽 lockdown | turns 到上限 → SessionStrip warn → ChatComposer "session full" → "request more ↗" | [~ code-quotas, session-strip] |
| B14 | visitor summary（多轮汇总） | summary endpoint | [✓ visitor-summary] |
| B15 | 首次 chat 填名字 | QR 进 / → VisitorNamePicker modal → 填名 / 跳过 | [✓ visitor-name-picker] |
| B16 | 从 blog 文末直接 follow-up | AskAboutThis starter prompt → `/?q=...` → root ChatRoom/long-scroll 自动喂 chat | [✓ ask-about-this] |
| B17 | 不离页在 blog/wiki/output 上 chat | FloatingChatDock pill → 展开面板 → 输入 → 同 session | [✓ 内置] |
| B18 | wiki/output private entry → LockedView | 没 code 访问 private wiki/output → "requires an access code" + gate link | [✓ 内置] |
| B19 | 搜 corpus（crawl face） | ChatRoom `CorpusSearchBox` → `corpus_search`（Meili lexical，ACL-gated per hit，Meili down→PG FTS degrade，never 500）→ 结果链 / friendly empty | [✓ retrieval-search-box, retrieval-search-consistency, retrieval-acl, retrieval-degrade] |
| B20 | 读带公式/图/callout 的 entry（render face） | `/wiki\|/output\|/writings/<path>` body 渲染 KaTeX 数学 · Mermaid 图 · Obsidian callout · TikZ · owner CSS snippet / per-note cssclasses | [✓ render-callouts, render-tikz, render-widget, render-owner-css, render-cssclasses] |

### 2.C Cross-actor / system journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| C1 | 完整 job loop 闭环 | A22→A23→A24→A25 → B1 → B5 → A19 | [~ 各段已覆盖，端到端串联 [ ]] |
| C2 | owner 看 transcript 反向补 corpus | A19 → A6 → A7 → 下次 visitor 命中 | [ ] |
| C3 | session 过期 / quota 用尽 | turns 到上限 → SessionStrip warn → ChatComposer lockdown → "request more ↗" | [~ code-quotas, session-strip] |
| C4 | instance reset (e2e teardown) | reset endpoint → 重 setup | [✓ 间接] |
| C5 | owner 改 handle（旧 URL 301） | A13 改 handle → handle_aliases 表 → 旧链跳 | [✓ public-url-edit] |
| C6 | BYOAI key 失效 → re-enter | chat 4xx → UI 提示 → /gate BYOAI | [ ] |
| C7 | visitor 跨 tab 共享 session | tab A login → tab B storage event → SessionStrip 同步出现 | [~ session-strip] |

---

## 3. Gap summary（基于上面 [ ] / [~] 数）

按优先级（business risk × 频率）排：

### P0 — 影响主路径但裸奔
- B9 private post LockedView（visitor 看不见但能 request access 入口）
- A11 post publish / unpublish / delete e2e
- A18 access request approve → auto-issue AccessCode
- C1 job loop 端到端串联（各段过，整链没串过）
- C3 quota 用尽后 ChatRoom 侧完整 case

### P1 — 高价值但易回归
- Custom domain + CNAME 流程
- Microsite rollback
- C6 BYOAI key 失效 re-prompt
- Login captcha toggle + Turnstile verify path
- Sources / Listings full table（需 admin REST endpoint）
- MCP `me` tool

### P2 — 边角 + 装饰
- Asset orphan sweep
- Canonical URL + RSS feed
- Turnstile captcha on login
- Account revoke all sessions

### P3 — 灰度 / dev only
- sysroutes（TLS ask / builder webhooks / health）
- reset endpoint 显式 case

---

## 4. 维护

- 新增 surface / feature → 加到 §1 对应位置 + 加 journey 到 §2
- 写新 spec → 把 [ ] / [~] 翻成 [✓ spec-name]
- 删 feature → 同步划掉条目 + 删对应 spec
- 定期（≥每月）跑一次 inventory：`ls e2e/test/*.spec.ts` 对照 §1.x [✓] 标，找漂移
