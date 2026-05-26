# StandMeet — Features & User Journeys

> 这份文档是 test backlog 的源头。先 enumerate 功能跟 journey，再基于这个补测试。
> 每条 case / journey 后面标 [✓ spec] 表示已覆盖，[~ spec] 部分覆盖，[ ] 未覆盖。
> 维护规则：动了 product surface → 同步改这里；写新 e2e → 把 [ ] 翻成 [✓ spec]。

---

## 1. Feature inventory（按 surface）

### 1.1 公开页 surfaces

#### `/` — Owner public page (single-owner v1)
- TopBar: handle / dark toggle / BYOAI 指示 [✓ public-page]
- AccessBanner（三档：public / byoai / coded）[✓ qr-code-absorb, byoai-chat]
- Hero（headline + chat 输入 dock）[✓ public-page]
- Conversation Deck（多 turn 历史 + reset + visitor name）[✓ visitor-chat-*]
- Insights（owner 最近 wiki/output 卡）[✓ public-page]
- Projects（curated 工作样本）[✓ page-edit-full]
- Where（looking-for status）[✓ page-edit-full]
- Contact（email / Twitter / Discord / LinkedIn 等）[✓ page-edit-full]
- Footer [ ]
- design 装饰：scanline / crosshair / sparkline / activity ticker / live-dot [ ]

#### `/gate` — 三档入口面板
- Code panel（输 LABEL-XXX + visitor name → POST /v1/sessions）[✓ access-codes, gate-access]
- BYOAI panel（provider preset + endpoint + model + key 4 项必填）[✓ byoai-chat]
- Request access form（email / name / org / message）[✓ gate-access]
- "what's behind" 解释段 [ ]

#### `/blog` — Blog index
- Cover card grid（amber / violet / acid hue + headline + excerpt + tags）[✓ blog-posts]
- Tag filter chips [ ]
- Infinite scroll（12/page，cursor 分页）[✓ blog-posts]
- Empty state [ ]

#### `/blog/<slug>` — Blog article
- Cover section [✓ blog-posts]
- ArticleHeader（title + meta + tags）[✓ blog-posts]
- GFM body 渲染（h2/h3/bold/italic/list/table/code/quote/img/checklist）[✓ blog-posts]
- 内联图（`standmeet-asset:<id>` → presigned URL）[✓ blog-posts]
- `[[crosslink]]` render-time rewrite [✓ blog-crosslinks]
- Backlinks aside（"linked from"）[✓ blog-crosslinks]
- LockedView（private post + 没 code → teaser + request CTA）[ ]
- XSS escape [✓ blog-posts]

#### `/wiki/<slug>` — Wiki SEO landing
- SEO og 标 + canonical [✓ wiki-landing]
- Body 渲（plain text + 链接）[✓ wiki-landing]
- Parent breadcrumb [ ]
- 链回主 chat CTA [ ]

#### `/output/<slug>` — Output SEO landing
- 同 wiki 但更精修 [✓ output-landing]

#### `/p/<slug>` — Custom React 页（owner 自写，SDK 嵌）
- Vite-built React 页 [✓ custom-page]
- 静态资源直 serve [✓ custom-page]
- Rollback 到上版 build [ ]

### 1.2 Auth + setup surfaces

#### `/setup?t=<token>` — 首次 claim
- 填 email / password / handle / fullName [✓ claim-instance]
- token 校验 + unclaim → claim [✓ claim-instance]

#### `/login` — Owner login
- Email + password [✓ owner-login]
- Turnstile captcha（toggle on）[ ]
- "forgot password" link [✓ password-reset]
- 登录失败 throttle [ ]

#### `/account/reset?t=<token>` — Password reset
- 输新 password → reset [✓ password-reset]

### 1.3 Admin backend (`/admin`)

#### Sidebar
- 6 主 section + api·mcp + custom pages + skills + output + access requests [✓ admin-auth-guards]

#### Raw
- list + filter / sort [✓ corpus-crud-ui]
- 编辑 body / tags / source / private-hint [✓ corpus-crud-ui]
- delete / archive [✓ corpus-crud-ui]
- promote_to_wiki modal [✓ corpus-curation]

#### Wiki
- hierarchical tree + parent 关系 [✓ corpus-crud-ui]
- create root / child [✓ corpus-crud-ui]
- edit title / path / body / tags [✓ corpus-crud-ui]
- SEO 编辑（seo_slug / seo_description / indexed / og_image）[~ seo-feeds]
- promote_to_output [✓ output-promotion]

#### Conversations
- list per code，paginated [✓ conversations-per-code]
- transcript 展开 + cited bodies [✓ conversations-per-code]
- search / filter [ ]

#### Codes
- create modal（label / corpus_permissions / quotas / suggested_questions / skills）[✓ access-codes, code-quotas]
- list grid + quota 进度 [✓ access-codes]
- QR 模态 + 下载 PNG [ ]
- edit code [ ]
- delete / revoke [ ]
- members 列（谁用过）[✓ member-quotas]

#### Connectors / API·MCP
- 外部 MCP server CRUD + test [✓ external-mcp-tools]
- AI provider config（owner-side default）[✓ ai-provider-config]
- API token CRUD [✓ api-tokens]
- MCP client download zip [ ]
- BYOAI toggle [ ]

#### Page customization
- handle 编辑 [✓ page-edit, public-url-edit]
- domain 编辑 + CNAME 提示 [ ]
- hero / projects / where / contact / BYOAI 区块编辑 [✓ page-edit-full]
- Save / dirty state [✓ page-edit]

#### Posts (blog admin)
- Tiptap 编辑器 + slash menu [✓ blog-posts]
- cover headline / sub / hue / cover image upload [✓ blog-posts]
- paste image → MinIO upload [✓ blog-posts]
- visibility / tags / cross_refs [~ blog-posts]
- publish / unpublish [ ]
- edit existing post [✓ blog-posts]
- delete post + 级联 asset / post_links [~ blog-crosslinks]

#### Custom Pages
- list + create + delete [✓ custom-page]
- 编辑器 + build [✓ custom-page]
- staging preview → promote live [✓ custom-page]
- rollback [ ]

#### Skills
- create skill（name + prompt + scripts）[✓ skills]
- list + delete [✓ skills]
- script with parameters → visitor 触发 [✓ skill-scripts]
- 绑 code [✓ skills]

#### Output
- list / edit / delete [✓ output-promotion]
- promote wiki to output [✓ output-promotion]

#### Account
- email / password 编辑 [✓ account-edit]
- login captcha toggle [ ]
- revoke all sessions [ ]

#### Access Requests
- list 待审 [ ]
- approve → auto-issue AccessCode（180d / 10 / 50）[ ]
- decline [ ]

#### Obsidian sync
- export → zip 下载（publish:true frontmatter gate）[✓ obsidian-sync]
- import → multipart upload + 幂等 [✓ obsidian-sync]

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
- exceeded → 拒 + UI banner [✓ code-quotas]
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
- session 落 localStorage（visitor-session）[✓ qr-code-absorb]
- conversation continuity（同 visitor 同 session）[✓ visitor-chat-*]
- visitor name picker 模态 [ ]
- 多 tab 共享 session [ ]

### 1.10 System / infra
- sysroutes: TLS ask / builder webhooks / health [ ]
- captcha verifier（Turnstile / noop）[ ]
- reset endpoint（e2e teardown 用）[✓ 间接]

---

## 2. User journeys

### 2.A Owner journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| A1 | 首次部署 + claim | `docker compose up` → `/setup?t=...` → 填表 → `/admin` | [✓ claim-instance] |
| A2 | 登录 | `/login` → cookie → `/admin` | [✓ owner-login] |
| A3 | 忘密码 | `/login` → forgot → email → `/account/reset?t=...` → 新密 | [✓ password-reset] |
| A4 | 配 server-side AI provider | `/admin/api-mcp` → provider + key → test → save | [✓ ai-provider-config] |
| A5 | 装 MCP client + bind Claude Desktop | API token → download zip → mcp.json | [~ api-tokens] |
| A6 | MCP raw_dump 喂 raw | Claude → raw_dump → `/admin/raw` 看到 | [~ corpus-curation] |
| A7 | 把 raw 升 wiki | MCP promote_to_wiki / admin UI promote modal | [✓ corpus-curation] |
| A8 | wiki 升 output | promote_wiki_to_output | [✓ output-promotion] |
| A9 | admin UI 写博客（Tiptap） | new post → slash menu → cover + paste image → publish | [✓ blog-posts] |
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

### 2.B Visitor journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| B1 | 扫 QR（recruiter 主入口） | `/?code=ABC` → absorb → URL 清 → coded banner | [✓ qr-code-absorb] |
| B2 | 手动输 code | `/gate` code panel → submit | [✓ gate-access, access-codes] |
| B3 | BYOAI 配 provider+key 走 chat | `/gate` BYOAI panel → vault 加密 → chat | [✓ byoai-chat, visitor-chat-byoai-public-only] |
| B4 | 没 code 申请 access | `/gate` request form | [✓ gate-access] |
| B5 | Chat 一轮 + 源 reveal | 输框打字 → SSE → cite | [✓ visitor-chat-cited-precise, -cites-output, -hidden-source] |
| B6 | 看 Insights / Projects / Where / Contact | root scroll | [✓ public-page] |
| B7 | 浏览 blog 列表 + 滚分页 | `/blog` infinite scroll | [✓ blog-posts] |
| B8 | 看 public 博客 + crosslink + backlink | `/blog/<slug>` GFM + `[[X]]` + linked-from | [✓ blog-posts, blog-crosslinks] |
| B9 | 看 private 博客 → LockedView | `/blog/<private>` 没 code | [ ] |
| B10 | wiki SEO landing | `/wiki/<slug>` | [✓ wiki-landing] |
| B11 | output landing | `/output/<slug>` | [✓ output-landing] |
| B12 | 看 custom page | `/p/<slug>` | [✓ custom-page] |
| B13 | tier 切换 fallback（quota 用尽 / 坏码） | 拒 → 提示 → 回 /gate | [~ qr-code-absorb invalid case] |
| B14 | visitor summary（多轮汇总） | summary endpoint | [✓ visitor-summary] |

### 2.C Cross-actor / system journeys

| # | Journey | 关键步骤 | spec 覆盖 |
|---|---|---|---|
| C1 | 完整 job loop 闭环 | A22→A23→A24→A25 → B1 → B5 → A19 | [~ 各段已覆盖，端到端串联 [ ]] |
| C2 | owner 看 transcript 反向补 corpus | A19 → A6 → A7 → 下次 visitor 命中 | [ ] |
| C3 | session 过期 / quota 用尽 | turns 到上限 → 拒 → UI banner | [~ code-quotas] |
| C4 | instance reset (e2e teardown) | reset endpoint → 重 setup | [✓ 间接] |
| C5 | owner 改 handle（旧 URL 301） | A13 改 handle → handle_aliases 表 → 旧链跳 | [✓ public-url-edit] |
| C6 | BYOAI key 失效 → re-enter | chat 4xx → UI 提示 → /gate BYOAI | [ ] |

---

## 3. Gap summary（基于上面 [ ] / [~] 数）

按优先级（business risk × 频率）排：

### P0 — 影响主路径但裸奔
- B9 private post LockedView（visitor 看不见但能 request access 入口）
- A11 post publish / unpublish / delete e2e
- A18 access request approve / decline → auto code
- C1 job loop 端到端串联（各段过，整链没串过）
- C3 quota 用尽后 visitor 侧 UX 完整 case（banner + 引导 /gate）

### P1 — 高价值但易回归
- Codes 行编辑 / delete / QR 下载 模态
- Custom domain + CNAME 流程
- Custom page rollback
- Visitor name picker 模态首次 chat
- BYOAI key 失效 re-prompt
- Login captcha toggle + Turnstile verify path
- Account revoke all sessions
- MCP `me` tool

### P2 — 边角 + 装饰
- "what's behind" gate 解释段
- Blog tag filter chips
- Wiki parent breadcrumb + 链回主 chat
- design 装饰（scanline / crosshair / activity ticker）
- Asset orphan sweep（即使存在也跑得通）
- Canonical URL + RSS feed
- 多 tab session 共享

### P3 — 灰度 / dev only
- sysroutes（TLS ask / builder webhooks / health）
- reset endpoint 显式 case
- code self-test 反向（owner 预览 visitor 体验，目前 [✓ code-self-test] 不确定深度）

---

## 4. 维护

- 新增 surface / feature → 加到 §1 对应位置 + 加 journey 到 §2
- 写新 spec → 把 [ ] / [~] 翻成 [✓ spec-name]
- 删 feature → 同步划掉条目 + 删对应 spec
- 定期（≥每月）跑一次 inventory：`ls e2e/test/*.spec.ts` 对照 §1.x [✓] 标，找漂移
