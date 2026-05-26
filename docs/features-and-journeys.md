# StandMeet — Features & User Journeys

> 这份文档是 test backlog 的源头。先 enumerate 功能跟 journey，再基于这个补测试。
> 每条 case / journey 后面标 [✓ spec] 表示已覆盖，[~ spec] 部分覆盖，[ ] 未覆盖。
> 维护规则：动了 product surface → 同步改这里；写新 e2e → 把 [ ] 翻成 [✓ spec-name]。

---

## 1. Feature inventory（按 surface）

### 1.1 公开页 surfaces

#### `/` — Owner public page (single-owner v1)
- TopBar: handle / dark toggle [✓ public-page]
- SessionStrip（sticky 顶条：code 标签 + gauge + BYOAI 紫 + warn + exit）[✓ session-strip]
- VisitorNamePicker modal（首次 chat 问名字，30d dismiss）[✓ visitor-name-picker]
- Hero（headline + chat 输入 dock + quota lockdown）[✓ public-page]
- Quota lockdown（used >= max → input 禁用 + "session full · request more"）[✓ session-strip]
- `?q=` URL 消费（blog AskAboutThis / starter 跳过来自动喂 chat）[✓ ask-about-this]
- Conversation Deck（多 turn 历史 + reset + visitor name）[✓ visitor-chat-*]
- Insights（owner 最近 wiki/output 卡）[✓ public-page]
- Projects（curated 工作样本）[✓ page-edit-full]
- Where（looking-for status）[✓ page-edit-full]
- Contact（email / Twitter / Discord / LinkedIn 等）[✓ page-edit-full]
- Footer [✓ public-page]
- design 装饰：scanline / crosshair / sparkline / activity ticker / live-dot [ ]

#### `/gate` — 三档入口面板
- Code panel（输 code + visitor name → POST /v1/sessions）[✓ access-codes, gate-access]
  - v5 polish: 大写归一 + paste 自动 submit + 错码 shake + "checking…" / "unknown code" 状态 [✓ gate-access]
- BYOAI panel（provider preset + endpoint + model + key 4 项必填）[✓ byoai-chat]
- Request access form（email / name / org / message）[✓ gate-access]
- "what's behind" 解释段 [ ]

#### `/blog` — Blog index
- Cover card grid（amber / violet / acid hue + headline + excerpt + tags）[✓ blog-posts]
- Tag filter chips [ ]
- Infinite scroll（12/page，cursor 分页）[✓ blog-posts]
- "or skip the reading · Ask the AI directly" CTA（文末跳 / chat）[✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock（右下角浮动 chat 面板，不离页 chat）[ ]
- Empty state [ ]

#### `/blog/<slug>` — Blog article
- Cover section [✓ blog-posts]
- ArticleHeader（title + meta + tags）[✓ blog-posts]
- GFM body 渲染（h2/h3/bold/italic/list/table/code/quote/img/checklist）[✓ blog-posts]
- 内联图（`standmeet-asset:<id>` → presigned URL）[✓ blog-posts]
- `[[crosslink]]` render-time rewrite [✓ blog-crosslinks]
- Backlinks aside（"linked from"）[✓ blog-crosslinks]
- AskAboutThis（文末 follow-up 输入条 + starter prompts → `/?q=...`）[✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [ ]
- LockedView（private post + 没 code → teaser + request CTA）[ ]
- XSS escape [✓ blog-posts]

#### `/wiki/<slug>` — Wiki SEO landing
- SEO og 标 + canonical [✓ wiki-landing]
- Body 渲（plain text + 链接）[✓ wiki-landing]
- Breadcrumb（writing / wiki · slug）[✓ wiki-landing]
- TrustBox（about this entry）[✓ wiki-landing]
- AskAboutThis（kind=wiki）[✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [ ]

#### `/output/<slug>` — Output SEO landing
- Breadcrumb（writing / output · slug）[✓ output-landing]
- TrustBox（about this piece）[✓ output-landing]
- AskAboutThis（kind=output）[✓ ask-about-this]
- SessionStrip [✓ session-strip]
- FloatingChatDock [ ]

#### `/p/<slug>` — Custom React 页（owner 自写，SDK 嵌）
- Vite-built React 页 [✓ custom-page]
- 静态资源直 serve [✓ custom-page]
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
- testid-based nav links（admin-nav-<slug>）[✓ admin-auth-guards]

#### Dashboard（/admin/dashboard）
- 4 KPI cards（raw unprocessed / wiki entries / active codes / pending requests）[✓ admin-auth-guards]
- "needs your hand" action rows（counts > 0 时 → jump 链接）[ ]

#### Raw
- list + 4-tab status filter (all/unprocessed/flagged-private/promoted) [✓ corpus-crud-ui]
- 编辑 body / tags / source / private-hint [✓ corpus-crud-ui]
- delete / archive [✓ corpus-crud-ui]
- promote_to_wiki modal [✓ corpus-curation]

#### Wiki
- tag-chip filter 行 + 2-col grid card（● public/private dot + title + tags + meta）[✓ corpus-crud-ui]
- create root / child [✓ corpus-crud-ui]
- edit title / path / body / tags [✓ corpus-crud-ui]
- SEO 编辑（seo_slug / seo_description / indexed / og_image）[~ seo-feeds]
- promote_to_output [✓ output-promotion]
- view live ↗ link [✓ wiki-landing]

#### Outputs
- 2-col card grid（cover strip + tier pill public/unlisted/private）[✓ output-promotion]
- create / edit / delete [✓ output-promotion]
- tier 推导（seo_indexed + show_as_source → public/unlisted/private）[ ]

#### Conversations
- list per code，paginated [✓ conversations-per-code]
- transcript 展开 + cited bodies [✓ conversations-per-code]
- private-hit badge（N sessions hit private topics）[ ]
- search / filter [ ]

#### Codes
- create modal（label / corpus_permissions / quotas / suggested_questions / skills）[✓ access-codes, code-quotas]
- list grid + "M active · N total" 计数 [✓ access-codes]
- QR 模态 + 下载 PNG [ ]
- edit code [ ]
- delete / revoke [ ]
- members 列（谁用过）[✓ member-quotas]

#### Access Requests
- list 待审 + "M new" / "N total" 计数 [ ]
- blockquote message display + filter chips [ ]
- approve → auto-issue AccessCode（180d / 10 / 50）[ ]
- decline [ ]

#### Drafts（/admin/drafts）
- GET /api/admin/drafts/ 真 fetch [✓ drafts-composer]
- draft card grid（company / role / for_job / matchPct / updatedAt）[ ]
- "open composer →" 进 ResumeComposer 全屏 overlay [ ]
- empty state（"No drafts pending."）[✓ drafts-composer]

#### Applications（/admin/applications）
- GET /api/admin/applications/ 真 fetch [✓ applications-detail-modal]
- application row（company / role / status pill / sent date）[ ]
- ApplicationDetailModal（timeline + contact + notes + snapshot + status segmented）[ ]
- empty state（"No applications sent yet."）[✓ applications-detail-modal]

#### Connectors
- "+ add connector" 按钮 → ConnectorAddModal [✓ connector-add-modal]
- ConnectorAddModal（5 category tabs + 18 entry catalog grid）[✓ connector-add-modal]
- ConnectorConfigForm（按 fields[] 动态渲 string/select/secret/oauth）[✓ connector-add-modal]
- toggle existing connectors [✓ connector-add-modal]

#### API · MCP
- AI provider config（owner-side default）[✓ ai-provider-config]
- API token CRUD [✓ api-tokens]
- External MCP server CRUD + test [✓ external-mcp-tools]
- MCP client download zip [ ]
- BYOAI toggle [ ]

#### Posts (blog admin)
- Tiptap 编辑器 + slash menu [✓ blog-posts]
- `[[crosslink]]` autocomplete（CrosslinkCommand + CrosslinkPicker tippy）[ ]
- cover headline / sub / hue / cover image upload [✓ blog-posts]
- paste image → MinIO upload [✓ blog-posts]
- visibility / tags / cross_refs [~ blog-posts]
- "N posts · M drafts" 计数 [ ]
- publish / unpublish [ ]
- edit existing post [✓ blog-posts]
- delete post + 级联 asset / post_links [~ blog-crosslinks]

#### Custom Pages
- table 视图（page / status / build / updated / actions）[✓ custom-page]
- "templates available" 4-cell grid [✓ custom-page]
- 编辑器 + build [✓ custom-page]
- staging preview → promote live [✓ custom-page]
- rollback [ ]

#### Skills
- create skill（name + prompt + scripts）[✓ skills]
- list + delete [✓ skills]
- script with parameters → visitor 触发 [✓ skill-scripts]
- 绑 code [✓ skills]

#### Page customization
- handle 编辑 [✓ page-edit, public-url-edit]
- domain 编辑 + CNAME 提示 [ ]
- hero / projects / where / contact / BYOAI 区块编辑 [✓ page-edit-full]
- Save / dirty state [✓ page-edit]

#### Account
- email / password 编辑 [✓ account-edit]
- login captcha toggle [ ]
- revoke all sessions [ ]

#### Obsidian sync
- export → zip 下载（publish:true frontmatter gate）[✓ obsidian-sync]
- import → multipart upload + 幂等 [✓ obsidian-sync]

#### Stub routes（design 已画，code 未实现，StubSection 占位）
- /admin/preview — 外部 view preview（tier 切换模拟）[ ]
- /admin/obsidian — import / export vault [ ]
- /admin/sources — job source register UI [ ]
- /admin/listings — 1d TTL 池子 [ ]
- /admin/seo — robots.txt / sitemap / OG 默认 [ ]
- /admin/system — instance health / container versions [ ]

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

#### Custom pages
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
- tier 切换 fallback（code 用尽 → public）[ ]

### 1.6 Quota system
- per-code max_sessions / max_turns_per_session / TTL [✓ code-quotas, turn-quota, quota-accumulation]
- per-member quota [✓ member-quotas]
- exceeded → 拒 + SessionStrip warn + AskInput lockdown [✓ code-quotas, session-strip]
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
- SessionStrip（跨 5 surface sticky 顶条 + gauge + warn）[✓ session-strip]
- conversation continuity（同 visitor 同 session）[✓ visitor-chat-*]
- visitor name picker 模态首次 chat [✓ visitor-name-picker]
- 多 tab 共享 session（cross-tab storage event sync）[✓ session-strip]
- FloatingChatDock（blog/wiki/output 浮动 chat 面板）[ ]

### 1.10 Design system
- sm-tokens.css（11 色 + serif/mono + tracking + motion）[✓ 内置]
- sm-atoms.css（session strip / visitor name picker / crosslink picker / composer / connector modal / floating chat 等 22+ atom 类）[✓ 内置]
- sm-mobile.css（≤720/900/1024 断点响应式）[✓ 内置]
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
| A5 | 装 MCP client + bind Claude Desktop | API token → download zip → mcp.json | [~ api-tokens] |
| A6 | MCP raw_dump 喂 raw | Claude → raw_dump → `/admin/raw` 看到 | [~ corpus-curation] |
| A7 | 把 raw 升 wiki | MCP promote_to_wiki / admin UI promote modal | [✓ corpus-curation] |
| A8 | wiki 升 output | promote_wiki_to_output | [✓ output-promotion] |
| A9 | admin UI 写博客（Tiptap + [[crosslink]]） | new post → slash menu → `[[` autocomplete → cover + paste image → publish | [✓ blog-posts] |
| A10 | MCP post_create 写博客 | post_create(GFM markdown, publish=true) | [✓ blog-posts] |
| A11 | publish / unpublish / delete post | admin UI 行操作 | [ ] |
| A12 | Obsidian sync | export zip / import vault zip | [✓ obsidian-sync] |
| A13 | 改 public page 区块 | `/admin/page` → hero/projects/where/contact | [✓ page-edit, page-edit-full] |
| A14 | 接 custom domain | `/admin/page` → domain → CNAME | [ ] |
| A15 | 写 custom React 页 | custom_page.create → write_file → build → promote | [✓ mcp-page-lifecycle, custom-page] |
| A16 | 接外部 MCP server | `/admin/api-mcp` MCP servers add | [✓ external-mcp-tools] |
| A17 | 手动签 access code | `/admin/codes` new code + 配额 + suggested Q | [✓ access-codes, code-quotas] |
| A18 | 审批 access request → auto code | approve → 180d/10/50 AccessCode | [ ] |
| A19 | 翻 conversations 看 transcript | `/admin/conversations` 展开 grounding | [✓ conversations-per-code, mcp-show-grounding] |
| A20 | Skills 创建 + 绑 code | new skill + scripts → 挂 code | [✓ skills, skill-scripts] |
| A21 | account 编辑（email / password / captcha） | `/admin/account` | [✓ account-edit] |
| A22 | 注册 job source | jobs.register_source(kind, config) | [✓ job-sources-register] |
| A23 | 拉新工作 + dedup + TTL | jobs.fetch_new → Redis 1d 池 | [✓ job-fetch-multi-source, -deduplicates, -ttl-eviction] |
| A24 | 起 resume draft + iterate | resume.draft / update_draft / discard_draft | [✓ resume-draft-*] |
| A25 | 投 application（闭环关键） | applications.commit → 写行 + auto code + PDF + QR | [✓ applications-commit, -qr-works, -playwright-hint] |
| A26 | SEO 全局设置 | seo.update_settings | [~ seo-feeds] |
| A27 | 添加 connector | `/admin/connectors` → "+ add" → 选 category → 填 fields → connect | [✓ connector-add-modal] |
| A28 | 看 dashboard | `/admin/dashboard` → 4 KPI card + needs-your-hand | [ ] |
| A29 | 看 drafts + open composer | `/admin/drafts` → draft card → "open composer →" → 6 panel + preview | [~ drafts-composer] |
| A30 | 看 applications | `/admin/applications` → row → detail modal → status / notes | [~ applications-detail-modal] |

### 2.B Visitor journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| B1 | 扫 QR（recruiter 主入口） | `/?code=ABC` → absorb → URL 清 → SessionStrip | [✓ qr-code-absorb, session-strip] |
| B2 | 手动输 code（paste 自动 submit） | `/gate` code panel → paste → shake on error → submit | [✓ gate-access, access-codes] |
| B3 | BYOAI 配 provider+key 走 chat | `/gate` BYOAI panel → vault 加密 → chat → SessionStrip 紫 "visitor-paid · unlimited" | [✓ byoai-chat, visitor-chat-byoai-public-only, session-strip] |
| B4 | 没 code 申请 access | `/gate` request form | [✓ gate-access] |
| B5 | Chat 一轮 + 源 reveal | 输框打字 → SSE → cite | [✓ visitor-chat-cited-precise, -cites-output, -hidden-source] |
| B6 | 看 Insights / Projects / Where / Contact | root scroll | [✓ public-page] |
| B7 | 浏览 blog 列表 + 滚分页 + CTA | `/blog` infinite scroll → "Ask the AI directly" CTA | [✓ blog-posts, ask-about-this] |
| B8 | 看 public 博客 + crosslink + backlink + AskAboutThis | `/blog/<slug>` GFM + `[[X]]` + linked-from + 文末 follow-up | [✓ blog-posts, blog-crosslinks, ask-about-this] |
| B9 | 看 private 博客 → LockedView | `/blog/<private>` 没 code | [ ] |
| B10 | wiki SEO landing + breadcrumb + trust box | `/wiki/<slug>` breadcrumb + TrustBox + AskAboutThis | [✓ wiki-landing, ask-about-this] |
| B11 | output landing + breadcrumb + trust box | `/output/<slug>` breadcrumb + TrustBox + AskAboutThis | [✓ output-landing, ask-about-this] |
| B12 | 看 custom page | `/p/<slug>` | [✓ custom-page] |
| B13 | tier 切换 fallback（quota 用尽 / 坏码） | 拒 → SessionStrip warn + "request more ↗" → lockdown AskInput | [~ qr-code-absorb invalid case, session-strip] |
| B14 | visitor summary（多轮汇总） | summary endpoint | [✓ visitor-summary] |
| B15 | 首次 chat 填名字 | QR 进 / → VisitorNamePicker modal → 填名 / 跳过 | [✓ visitor-name-picker] |
| B16 | 从 blog 文末直接 follow-up | AskAboutThis starter prompt → `/?q=...` → root 自动喂 chat | [✓ ask-about-this] |
| B17 | 不离页在 blog/wiki/output 上 chat | FloatingChatDock pill → 展开面板 → 输入 → 同 session | [ ] |

### 2.C Cross-actor / system journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| C1 | 完整 job loop 闭环 | A22→A23→A24→A25 → B1 → B5 → A19 | [~ 各段已覆盖，端到端串联 [ ]] |
| C2 | owner 看 transcript 反向补 corpus | A19 → A6 → A7 → 下次 visitor 命中 | [ ] |
| C3 | session 过期 / quota 用尽 | turns 到上限 → SessionStrip warn → AskInput lockdown → "request more ↗" | [~ code-quotas, session-strip] |
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
- A18 access request approve / decline → auto code
- C1 job loop 端到端串联（各段过，整链没串过）
- C3 quota 用尽后 visitor 侧 UX 完整 case（SessionStrip warn + AskInput lockdown + /gate 引导）

### P1 — 高价值但易回归
- Codes 行编辑 / delete / QR 下载 模态
- Custom domain + CNAME 流程
- Custom page rollback
- BYOAI key 失效 re-prompt
- Login captcha toggle + Turnstile verify path
- Account revoke all sessions
- MCP `me` tool
- FloatingChatDock e2e spec（component 已落，spec 未覆盖）
- `[[crosslink]]` autocomplete e2e spec（extension 已落 + PluginKey fix，spec 未覆盖）
- Drafts card grid + "open composer" e2e（需要 seed fixture 先走 MCP resume.draft 链）
- Applications detail modal e2e（需要 seed fixture 先走 MCP applications.commit 链）

### P2 — 边角 + 装饰
- "what's behind" gate 解释段
- Blog tag filter chips
- design 装饰（scanline / crosshair / activity ticker）
- Asset orphan sweep（即使存在也跑得通）
- Canonical URL + RSS feed
- Dashboard "needs your hand" e2e
- Conversations private-hit badge
- Output tier pill e2e

### P3 — 灰度 / dev only
- sysroutes（TLS ask / builder webhooks / health）
- reset endpoint 显式 case
- code self-test 反向（owner 预览 visitor 体验，目前 [✓ code-self-test] 不确定深度）
- Admin stub routes（preview / sources / listings / seo / system）—— design 已画，StubSection 占位

---

## 4. 维护

- 新增 surface / feature → 加到 §1 对应位置 + 加 journey 到 §2
- 写新 spec → 把 [ ] / [~] 翻成 [✓ spec-name]
- 删 feature → 同步划掉条目 + 删对应 spec
- 定期（≥每月）跑一次 inventory：`ls e2e/test/*.spec.ts` 对照 §1.x [✓] 标，找漂移
