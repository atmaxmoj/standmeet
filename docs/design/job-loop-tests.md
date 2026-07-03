# StandMeet Job Loop — 测试设计

> **状态：** 草稿，待评审（2026-05-20）。配套 [`job-loop.md`](job-loop.md) 读。
> **读者：** 写 fixture / mock 服务器 / spec 的人。
> **怎么反馈：** 每块结尾 `T.n` 决策点，回 `Tn: accept` / `Tn: change — <…>`。

---

## TL;DR — 测试哲学

1. **CLAUDE.md 的 "no mocks for external deps" 在网络边界外有边界**。job board 是真·外部，CI 不能砸 Greenhouse 100 次 / 测试不能依赖 LinkedIn 在线。**mock 在 HTTP 层**，**不 mock 在 fetcher 层**——fetcher 代码用真，只把它的 baseURL 指向我们起的 fake server。
2. **不写单元测试**（沿用项目规则）。所有覆盖通过 e2e 实现。
3. **UI-driven 优先**（[[feedback-e2e-ui-driven-only]] 规则）。但当某个 surface 只有 MCP 入口、没有 admin UI 镜像时，允许 MCP-driven spec（先例：`corpus-curation.spec.ts`）。
4. **测试文件按 business behavior 命名**（[[feedback-e2e-ui-driven-only]]）—— 不要 `phase1-tests.spec.ts`，要 `job-sources-register.spec.ts`。

**决策点 T.1：上述哲学接受。**

---

## 网络层 mock 策略

### Job board mock server

新加一个 docker-compose service `external-mock`：一个轻量 HTTP server（Go 写在 `backend/cmd/external-mock` 跟 backend 同 binary 复用，**不**用 node express），按下面的路径喂 fixture JSON / RSS：

```
GET  /greenhouse/v1/boards/{co}/jobs?content=true
GET  /lever/v0/postings/{co}?mode=json
GET  /ashby/posting-api/job-board/{slug}
GET  /remoteok/api
GET  /wwr/categories/{slug}.rss
GET  /hn/v0/user/whoishiring.json
GET  /hn/v0/item/{id}.json
```

每条路径背后 fixture 文件名约定：`e2e/fixtures/job-boards/{kind}/{co_or_slug}.{day}.{ext}` —— 例如 `greenhouse/airbnb.day1.json`、`lever/leverdemo.day1.json`、`hn/whoishiring.day1.json` + `hn/item-{id}.json`。

mock server 接两个 query param 让 spec 切换"今天看到的世界"：
- `?day=1` / `?day=2` —— 决定服务哪份 fixture（spec 通过环境跨 HTTP 改 mock 的"当前日"或者通过特殊管理端 `POST /__mock/set_day?day=2`）

backend 通过环境变量切 base URL，**production 这些 env 不设**：

```
GREENHOUSE_BASE_URL=http://external-mock:9000/greenhouse
LEVER_BASE_URL=http://external-mock:9000/lever
ASHBY_BASE_URL=http://external-mock:9000/ashby
REMOTEOK_BASE_URL=http://external-mock:9000/remoteok
WWR_BASE_URL=http://external-mock:9000/wwr
HN_BASE_URL=http://external-mock:9000/hn
```

fetcher 代码里默认 const = 真 URL，env 非空就 override。同时**所有 fetcher 都走同一个注入的 `*http.Client`**（已有 pattern），spec 不重写 client，只重写 URL。

**决策点 T.2：fetcher → URL override env，mock server 跟 backend 同 binary，fixture 按 kind/{co}.day{n}.{ext} 命名。**

### LLM mock 边界（**三处**，讲清楚）

系统里"AI 干活"出现在三个不同位置，e2e 各用各的 stand-in，不要混：

| LLM 调用位置 | 谁调 | e2e stand-in |
|---|---|---|
| **A. 访客 chat reply**（recruiter 扫 QR 进来发 message，AI 用 owner voice 答）| 后端 (`internal/inference`) → Anthropic API | 已有 `INFERENCE_PROVIDER=mock` 把 provider 切成 MockProvider，e2e 之前就用，`qr-scan-to-chat` 直接复用。**不要新写**。 |
| **B. owner 在 Claude Code 里"批改"/"撰写" resume / 排序 job**（real production: Claude 拿 owner's MCP context + 自己 reason）| **owner 的 Claude，**不在 StandMeet 进程内 | e2e 里"Claude"不存在 —— **测试代码本身扮演 Claude**：用预先准备的 fixture JSON 当作"Claude 写的 resume_content"喂给 `resume.draft(...)`、用 fixture criteria 当 jobs 排序结果断言。fixtures 在 `e2e/fixtures/resume/*.json`、`e2e/fixtures/application/*.json`。 |
| **C. 服务端 reason about job / resume**（hypothetical: 后端把 HN 自由 text 抽成结构化 FetchedJob、后端对 resume 打分）| **不存在 by design** —— 见 [job-loop.md](job-loop.md) "状态跟 reasoning 的分工"决策 L.1 | n/a — 我们没这条路径，e2e 不需要 mock LLM 在服务端 |

**决策点 T.11：三处 LLM 边界明确**：(A) MockProvider 已有，(B) 测试代码扮演 Claude 用 fixture content，(C) 服务端无 LLM 调用所以没 mock。任何 PR 想加 server 端 LLM 调用，必须先单独评审 —— 会推翻分工原则。

#### fixture 质量门槛（B 类 fixture 不能糊弄）

测试 fixture 当"Claude 输出"用的时候，**必须像真 Claude 输出**：

- `resume_content_alice.json` 至少含：1 个有 5+ bullets 的 work、3 个 STAR project（每段 30+ 字）、4 个 skill category、教育 1 条、links 2 条
- `application_acceptance_alice.json` 喂的 tags 至少 5 个（模拟 Claude 从 JD 派生的 tag set）
- **不**用 `{"name":"Test","email":"t@t.t"}` 这种敷衍 fixture —— 那种 fixture 让 PDF 渲染 / 字段断言看起来过其实漏了一堆边界

**决策点 T.12：fixture 内容质量门槛写入 `e2e/fixtures/README.md`，code review 时按这套标准卡。**

### 已有的 mock：复用

- **mock 推理 provider** 已经在 `internal/inference/mock.go`，e2e 通过 `INFERENCE_PROVIDER=mock` 启用 —— 直接复用给 QR-scan-to-chat 这条路。**不要新写**。
- **mock token / setup token** 已经在 `e2e/fixtures/instance.ts` —— 直接复用。
- **resetInstance** 现有 truncate 列表里**加 `job_sources`, `job_fingerprints`, `resume_drafts`, `applications`** 三张新表。
- **Redis FLUSHALL** 已经在 resetInstance 里，TTL job 池子跟着清，不用改。

**决策点 T.3：复用所有现有 mock 基础设施，扩 resetInstance 的 TRUNCATE 列表。**

---

## PDF / QR 校验策略

**真扫，每条 QR 相关 spec 都从 PDF 解图像。** 理由：测的是"recruiter 拿到 PDF 能不能扫出来 URL"这一行为本身——QR 太小 / 抗锯齿失真 / margin 不够 / ECC level 选低了导致手机扫不到，这些都只能通过解真图像才发现，信 `deeplink_url` 字段只测后端逻辑不测 PDF 渲染输出。

1. **PDF 文字层**：`pdf-parse` 抽 text，断言 name / email / 公司名 / project 名等出现。
2. **PDF 图像 + QR 解码**（**新主路径**）：
   - 抽 helper `e2e/fixtures/qr.ts`：`export async function scanQRFromPDF(buf: Buffer): Promise<string>`
   - 实现：`pdfjs-dist` 渲第一页到 canvas（Node 端用 `@napi-rs/canvas` 或类似 polyfill），右上角 region 裁剪交 `jsqr` 解，返回 URL string
   - **决策点 T.4a**：实现里走 `pdfjs-dist + @napi-rs/canvas + jsqr` 而非 `pdftoppm`（保持 e2e 不引入系统级依赖，container 内可重复）
3. **`applications.show()` 仍返 `invitation.deeplink_url`**——给 owner /admin/applications UI 用（"复制链接"、"预览 QR 目标"）。spec 把它当 cross-check 比较项之一，**不**作为 ground truth。Ground truth = 扫出来的 URL。
4. **`qr-scan-to-chat` 闭环 spec 严格走"recruiter 路径"**：commit → PDF → scanQR → goto(scannedURL) → chat。中间不允许 applications.show().deeplink_url 短路。

**决策点 T.4：QR 相关 spec 全部从 PDF 真扫 image。`applications.show().deeplink_url` 仅供 UI 和 cross-check，不作 e2e ground truth。**

---

## 时间 mock

TTL 测试不能真等 24 小时。用两条路径：

- **Redis TTL**：spec 拿到 `job_cache_id` 后通过 docker exec 直连 redis 把 key 设短 TTL（`PEXPIRE ... 100`），等 200ms 再 fetch 验证已 gone。
- **PG `expires_at`**：直接 psql UPDATE。

**不**起 fake clock / 不在代码里加 "time provider" 抽象。**决策点 T.5：时间通过 docker exec 直接 manipulate Redis/PG state，不引入 clock 抽象。**

---

## 阶段 1：job sources + fetcher + Redis TTL 池子

### 1.1 `job-sources-register.spec.ts`

**业务行为：** owner 在 /admin/sources 加一个 Greenhouse 源，list 立刻看到。

UI 路径：
1. claim → login → 进 `/admin/sources`（新 section）
2. 点 `+ new source` → 选 kind=greenhouse → 填 `company=airbnb` + label="Airbnb careers" → 创建
3. 列表里出现一条 `Airbnb careers` (`testid: source-row-airbnb`)
4. 点 unregister → 列表里消失

API 旁路：同时 spec 末尾用 MCP `jobs.list_sources()` 也确认 0 条（cleanup 完整）。

### 1.2 `job-fetch-deduplicates.spec.ts`

**业务行为：** fetch 两次，第二次空 —— 见过的 job 不再出现。

mock 配置：fixture `greenhouse/airbnb.day1.json` = 3 jobs (id=A, B, C)。

1. setup: UI 注册 Airbnb 源（或 fixture API 注册更快）
2. MCP `jobs.fetch_new()` → 断言返 3 条，每条有 `cache_id`
3. MCP `jobs.fetch_new()` 立刻再调 → 断言返 0 条（同源未变 fingerprint 全命中）
4. mock server `POST /__mock/set_day?day=2`，切到 `airbnb.day2.json` = 4 jobs (B, D, E, F —— A/C 不见了，D/E/F 新)
5. MCP `jobs.fetch_new()` → 断言返 3 条（D, E, F），不返 B（已 fingerprint）

### 1.3 `job-fetch-multi-source.spec.ts`

**业务行为：** 注册两个不同 kind 的源，fetch_new 返回两边的 union。

1. 注册 greenhouse:airbnb + hn_hiring
2. mock: airbnb 2 条 + 当月 HN whoishiring 帖子 3 条评论
3. MCP `jobs.fetch_new()` → 断言返 5 条
4. 校验返回里有 `source_kind` 字段区分

### 1.4 `job-fetch-ttl-eviction.spec.ts`

**业务行为：** fetch 出来的 job 1 天后自动消失，`jobs.show(cache_id)` 返 not_found。

1. 注册源 + fetch → 拿一个 `cache_id`
2. docker exec redis-cli `PEXPIRE job:{owner_id}:{cache_id} 100`
3. wait 200ms（或 polling 验证）
4. MCP `jobs.show(cache_id)` → 断言 `not_found` envelope

### 1.5 `job-discard.spec.ts`

**业务行为：** `jobs.discard(cache_id)` 立刻让 `jobs.show(cache_id)` 404。

简短 spec，单点行为。

### 1.6 `mcp-jobs-auth.spec.ts`（小）

**业务行为：** 无 token / 错 token 调 `jobs.fetch_new` 返 unauthorized。

mirror `mcp-auth.spec.ts` 的 pattern，加 `jobs.*` 几个工具。**决策点 T.6：复用现有 mcp-auth.spec.ts 的代码骨架，不另起。**

---

## 阶段 2：resume draft → preview → commit (preview 部分)

### 2.1 `resume-draft-preview.spec.ts`

**业务行为：** Claude 喂 resume_content → 后端给出 preview PDF URL，PDF 含 owner 身份字段，QR 位是 placeholder。

1. setup: 注册源 + fetch → 拿 `job_cache_id`
2. spec 用一份 hand-crafted fixture `resume_content_alice.json`（标准 identity + 1 work + 1 project STAR + skills）
3. MCP `resume.draft(job_cache_id, content)` → 断言返 `{draft_id, preview_pdf_url}`
4. HTTP GET `preview_pdf_url` → `pdf-parse` 抽 text → 断言 `"Alice Anderson"`、email、公司名、project 名都在
5. 断言 PDF 文字里**没有**真 access code 字符串（preview 阶段 QR placeholder）

### 2.2 `resume-draft-update.spec.ts`

**业务行为：** update_draft 改 content → preview PDF 重算。

1. draft 出 v1 → 抓 PDF md5
2. update_draft 把 summary 换一句 → PDF md5 变 → text 校验新 summary 出现

### 2.3 `resume-draft-discard.spec.ts`

**业务行为：** discard → 之后 commit 同 draft_id 报 not_found。

### 2.4 `resume-draft-ttl.spec.ts`

**业务行为：** draft 1d TTL 过期 → commit 报 not_found。

PG `UPDATE resume_drafts SET expires_at = now() - interval '1h' WHERE id = '...'` 再 commit。

---

## 阶段 3：commit + invitation + QR + ?code 全链路

### 3.1 `application-commit-issues-invitation.spec.ts`

**业务行为：** commit 一条 draft → applications 表写一行 + access_codes 表自动新增一条（默认值正确）+ 正式 PDF 渲染 + PDF 里的 QR 解出来 URL 正确。

1. setup: fetch → draft → commit
2. 断言 `applications.show(application_id)` 返：
   - `invitation.expires_at` ≈ `applied_at + 180d`（误差 ≤ 1 分钟）
   - `invitation.max_sessions_per_member == 10`
   - `invitation.max_turns_per_session == 50`
   - `invitation.label == "{title} @ {co}"`
   - `invitation.suggested_questions.length == 4`
3. 断言 `pdf_url` 可访问 + 文字层含 owner 身份 + 工作内容
4. **从 PDF 真扫 QR**：`scanQRFromPDF(buf)` → 断言 URL 形如 `https://{public_url}/{handle}?code={non_empty_code}` 且 `code === invitation.code`
5. /admin/codes UI 列表里能看到这条 invitation（label 匹配）

### 3.2 `application-qr-image-quality.spec.ts`

**业务行为：** PDF 渲染的 QR 在多种 PDF 处理路径（直接 fetch、压缩后 fetch、缩放后 fetch）下都能扫得出来。给 recruiter 把 PDF 转发 / 截图 / 缩放 后真扫的情况留余量。

1. setup: commit → `pdf_url`
2. fetch PDF → scanQR → 通过
3. fetch PDF → 缩到 50% 重渲（用 pdfjs-dist + 小 viewport）→ scanQR → 通过
4. fetch PDF → 取第一页 PNG → 转 JPEG quality=70 → scanQR → 通过
5. （这条 spec 也保护 QR ECC level 选得够高 + margin 够大）

### 3.3 `qr-scan-to-chat.spec.ts`（**闭环关键**）

**业务行为：** **严格走 recruiter 路径**：拿 PDF → 真扫 QR 拿 URL → goto → 不经 /gate → 直接进 chat → 发 message → 收 reply → URL 里 `?code=` 已抹掉。

中间**不允许**用 `applications.show().deeplink_url` 短路。

1. setup（全链路）: fetch → draft → commit → 拿 `pdf_url`
2. fetch PDF buffer → `scannedURL = await scanQRFromPDF(buf)`
3. `page.goto(scannedURL)`
4. 断言 url 在 `**/{handle}` 不在 `**/gate`
5. 断言 chat input 出现（不是 gate code 输入框）
6. 断言 `page.url()` 不含 `?code=`（history.replaceState 生效）
7. 在 chat 里发 `"tell me about Alice"`
8. 断言 reply 出现 + reply 文字 = mock provider 配置的 `INFERENCE_MOCK_REPLY`
9. owner 视角：进 /admin/codes 那条 invitation 详情，看到 1 个 visitor 进来 + 1 条 conversation

### 3.4 `application-list-shows-applied.spec.ts`

**业务行为：** /admin/applications UI 列出已申请。

1. setup: commit 一条
2. UI: 访问 /admin/applications → 断言 row 出现 (`testid: application-row-{id}`) → 显示 title @ company + applied_at
3. 点链接 → 进 /admin/codes/{invitation_id} 详情

### 3.5 `application-withdraw-revokes-invitation.spec.ts`

**业务行为：** /admin/applications UI 改 status=withdrawn → invitation 在 /admin/codes 显示 revoked。

1. setup: commit
2. UI: /admin/applications row → 点 "..." → 选 "Withdraw" → 确认 modal
3. 断言 row status badge = `withdrawn`
4. UI: /admin/codes 那条 code → 断言 status = `revoked`
5. spec 末尾再 hit 这条 code 一次 visitor session create → 断言 backend 返 `code_invalid`（已 revoke）

### 3.6 `application-next-event-manual.spec.ts`

**业务行为：** owner 手填 `next_event_at` —— 给日历 PR 留的位先 UI 跑通。

1. setup: commit
2. UI: row 上有 "set next event" → 填日期 `2026-06-10 14:00` + notes "phone screen"
3. 断言 row 显示 `next_event_at` 列 = 那个日期
4. reload → 还在

### 3.7 `application-commit-rehydrates-job.spec.ts`

**业务行为：** draft 阶段 Redis 池子里 job evicted（TTL 过期）后，**commit 仍能成功** —— 因为 L.13 决策（draft 创建时已 snapshot job 进 draft 行）。

1. setup: fetch → draft → docker exec 干掉 Redis key
2. commit → 断言成功 + applications.job_snapshot 跟 fetch 出来时的 fixture 内容一致

---

## 阶段 4：playwright hint

### 4.1 `commit-response-has-playwright-hint.spec.ts`

**业务行为：** commit 响应里 `next_action_hint` 字段存在，文字含 `playwright`、`apply_url`、`pdf_url`。

简短 spec，单点 contract 测。

---

## 跨阶段交叉测试

### X.1 `multi-tenant-job-isolation.spec.ts`（保险）

**业务行为：** owner A 注册的源、产生的 fingerprint、applications 不会被 owner B 看到。

虽然 v1 单 owner instance，但所有表都已经按 owner_id 切，spec 防回归。需要起两个 owner —— `claim` 走 setup token 这条路只能 claim 一次，所以这条 spec 需要先把 instance manually 改成已支持 multi-tenant（或直接 PG 插第二条 owner row 作 fixture）。

**决策点 T.8：本测试**不**入 phase 1–3 必跑列表，留到将来开 multi-tenant 时一并写。**

### X.2 `mcp-source-config-validation.spec.ts`

**业务行为：** register_source 传错的 config 形状 → 报参数错误。

每个 source kind 配一个 schema：
- greenhouse 需要 `company`
- lever 需要 `company`
- ashby 需要 `slug`
- remoteok 不需要 config（aggregate）
- wwr 需要 `categories: []`
- hn_hiring 不需要 config

spec 喂错 config 断言 envelope code=`bad_request`、message 提示哪个字段缺。

---

## fixture 清单 — **已抓真 snapshot**（2026-05-20）

实际抓取产物在 `e2e/fixtures/job-boards/`，覆盖：

| Source kind | 真 boards 数 | 文件命名 |
|---|---|---|
| `greenhouse/` | 25 | `airbnb`, `stripe`, `vercel`, `figma`, `anthropic`, `dropbox`, `instacart`, `pinterest`, `reddit`, `gusto`, `duolingo`, `elastic`, `gitlab`, `cloudflare`, `datadog`, `mongodb`, `mercury`, `chime`, `brex`, `lyft`, `robinhood`, `asana`, `affirm`, `fivetran`, `samsara` |
| `lever/` | 4 | `leverdemo`, `highspot`, `jobvite`, `palantir` |
| `ashby/` | 4 | `Ashby`, `Linear`, `Notion`, `posthog`, `supabase` |
| `remoteok/` | 1 | `api`（aggregate） |
| `wwr/` | 10 | 全部 10 个 category RSS |
| `hn/` | 10 | `whoishiring` + `item-47975571`（May 2026 thread）+ 8 真 postings |
| `smartrecruiters/` | 1 | `visa`（v1.1） |
| `workable/` | 6 | `typeform`, `mux`, `marshmallow`, `intercom`, `mistralai`, `rechargehq`（v1.1，**注意**：`widget/accounts` 返的是 account metadata 不是 jobs，jobs endpoint 待实现 adapter 时确认） |

每个 fixture **trim 到 ≤ 8 jobs / items 保 git 体积**（4 MB total）。完整未 trim 的 raw 捕获放 `.raw/`（gitignore）。

工具脚本：
- `e2e/fixtures/job-boards/capture.sh` —— 重抓 raw（curl 真 API + 礼貌 UA）
- `e2e/fixtures/job-boards/trim.sh` —— 把 raw 截到 8 条进 git path
- `Makefile`: `make capture-job-fixtures` / `make trim-job-fixtures` 包它们（待加）
- `e2e/fixtures/job-boards/README.md` —— inventory + day2 生成约定

### day2 fixtures（dedup test 用）

day2 不再次访问真 API ——**从 day1 派生**（前 2 条消失 + 后 2 条新增），避免真 API 漂移把 day1 → day2 的预期 diff 弄乱。day2 manifest（每个 board 期望的"新增 ID 集合"）由 `gen-day2.sh` 生成 + e2e import。

### Application + resume fixture

```
e2e/fixtures/resume/
└── resume_content_alice.json   # rich content per T.12 标准

e2e/fixtures/application/
└── application_acceptance_alice.json   # commit 入参（draft_id 占位）
```

**决策点 T.9：fixture 经 `make capture-job-fixtures` 手动维护**（rate limit + 漂移控），季度 refresh。已抓的 snapshot 时间戳记在 [`e2e/fixtures/job-boards/README.md`](../../e2e/fixtures/job-boards/README.md)。

---

## CI / 本地 make 集成

新 docker-compose service `external-mock` 起在 9000 port。`make test` 已有的 docker-compose up --wait 会带它起来。

新增 spec 自然被 `pnpm exec playwright test` 收集，**不**需要改 playwright config。

**决策点 T.10：mock server 跟 backend / app / db / redis 等同 docker-compose 服务，`make test` 自带。**

---

## Open questions（不阻塞）

- **fixture 跟真 API 同步频率**：未来真 board 改了字段 fixture 没改 → fetcher 测过但实际跑挂。需要个 `make verify-fixtures` 跑真 API 比对最新结构（季度跑一次）。
- **Captcha / rate limit 在 mock server**：暂不模拟。如果真出现 fetcher 处理 429 的需求再加。
- **HN 月度切换**：HN whoishiring 每月 1 号换帖。fixture 永远是某一个具体月份的 snapshot。fetcher 用 `whoishiring.submitted[0]` 拿"最新"那条 —— mock fixture 也按这条 contract 排序就 OK。

---

## 决策点汇总

T.1 测试哲学（mock 在网络边界 / e2e only / UI-driven 优先 / 业务命名）
T.2 fetcher URL override env + mock server 跟 backend 同 binary + fixture 命名规范
T.3 复用现有 mock 基础设施 + resetInstance 扩 truncate 列表
T.4 QR 校验**全部从 PDF 真扫**，`deeplink_url` 仅 UI / cross-check 用，不作 ground truth
T.4a 实现走 `pdfjs-dist` + `@napi-rs/canvas` + `jsqr`（不引入系统级依赖 like `pdftoppm`）
T.5 时间通过 docker exec 直接改 Redis/PG 状态，不引入 clock 抽象
T.6 复用现有 `mcp-auth.spec.ts` 骨架
T.7 ~~PDF→QR 图像解码 spec 打 regression-once tag~~ —— 已并入 T.4，所有 QR spec 每次跑
T.8 multi-tenant 隔离测试推后到开 multi-tenant 时一起写
T.9 fixture 通过 `make capture-job-fixtures` 手动维护
T.10 mock server 进 docker-compose
T.11 三处 LLM 边界：(A) MockProvider 复用、(B) 测试代码扮演 owner-side Claude 喂 fixture content、(C) 服务端无 LLM 调用所以无 mock
T.12 fixture 质量门槛（rich content，不糊弄）写入 `e2e/fixtures/README.md`，code review 时卡
