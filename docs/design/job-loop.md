# StandMeet Job Loop — 完整产品全貌

> **状态：** 设计中（2026-05-20 起草）。本文档把 outbound 求职链跟现有 inbound visitor chat 接成一个完整闭环的设计决策固化下来。
> **读者：** 实际要写这套东西的人。默认你已读 `CLAUDE.md`、读过 `job-loop-2026-05` 那条 memory。
> **怎么反馈：** 每块结尾有编号的决策点（`L.1`、`L.2`、…）。回 `Lₙ: accept` 或 `Lₙ: change — <理由>`。没提到的视作 accept。

---

## TL;DR — 一句话讲完

owner 在 Claude Code 里问"今天 [filter] 有什么新工作"，Claude 通过 MCP 拉数据，owner 选中两个，Claude 读 corpus 给每个写一份定制 resume **草稿**，owner 在 staging 预览看过点头才正式发，发的时候自动 issue 一条 invitation（复用 access_codes 表）、把 invitation URL 编成 **QR 印在 resume 右上角**、Playwright MCP 接着填表，投出去；recruiter 拿到 PDF 扫 QR → `/<handle>?code=ABC` → 直接进现有的 visitor chat → AI 用 owner voice 答 → **闭环**。

---

## 状态分工：StandMeet 是 state holder，Claude 是 reasoning + I/O

| 任务 | Who | 为什么 |
|---|---|---|
| 拉 job 数据（HTTP / RSS / parse） | StandMeet | adapter 知识 / rate limit / User-Agent / dedup |
| 1d TTL 池子（fetch 出来的暂存） | StandMeet | Redis 状态 |
| **挑哪条 / 排序 / 评估**  | **Claude** | owner 的口味在 corpus 里 |
| **写 resume 草稿内容**  | **Claude** | curate raw + wiki + JD 是 LLM 工作 |
| 渲染 PDF（固定 layout + QR） | StandMeet | 确定性 / 安全 / ATS-friendly |
| 持久化 application + invitation | StandMeet | DB 状态 |
| **填表自动化**  | **Claude + Playwright MCP** | 每个公司的 UI 漂移 / Playwright 不在 StandMeet 跑 |

**决策点 L.1：state 跟 reasoning 的分工以上图为准。**

---

## 名词去重

- **AccessCode 就是 invitation 就是邀请码**。同一张 `access_codes` 表，同一个域类型。当初这个 schema 就是为了"我投出去的简历带个码进来跟 AI 聊"准备的。
- 任何代码 / 文档里都不要再起 `ApplicationAccessCode` / `Invitation` 这种平行概念。
- 自然语言里讲"邀请码"OK，"invitation" OK，"access code" OK，**指的是同一行 access_codes 数据**。

**决策点 L.2：术语统一为 AccessCode，对外文案可以叫"邀请码"。**

---

## 完整 user journey

```
owner @ Claude Code （持 standmeet MCP + playwright MCP）
   │
   │ "今天 staff IC remote 有什么新工作"
   ▼
[1] Claude → jobs.fetch_new(criteria?)
   │      ── StandMeet ──
   │      │ 调注册的 N 个源 (Greenhouse / Lever / Ashby / RemoteOK
   │      │ / WWR / HN Who-is-Hiring)
   │      │ 拿全量 → diff against job_fingerprints 去重
   │      │ 新条目进 Redis 1d TTL 池子（key: owner_id:job_cache_id）
   │      │ 写 fingerprint
   │      └ 返回 N 条 job (含 cache_id / 标题 / company / JD / source_kind / apply_url)
   │
   │ Claude 自己排序，按 owner.page.where.looking_for + corpus
   │ 给出 top 推荐
   ▼
[2] owner: "对，#3 和 #7 这两个，准备投"
   │
   ▼
[3] Claude（对每条 job）：
   │   - 读 corpus（已有 MCP: list_recent_raw / list_recent_wiki / search）
   │   - 读 job JD（jobs.show(cache_id) 或上一步缓存）
   │   - 撰写 resume_content（结构化 JSON，shape 见下）
   │   ▼
   │ Claude → resume.draft(job_cache_id, resume_content)
   │      ── StandMeet ──
   │      │ 写 resume_drafts 表 (id, owner_id, job_cache_id, resume_content jsonb,
   │      │ created_at)，1d TTL（跟 job 池子同周期，过期一起删）
   │      │ 渲染**预览 PDF**（layout 是真的，QR 是占位 placeholder）
   │      └ 返回 { draft_id, preview_pdf_url }
   │
   │ Claude 把 preview_pdf_url 给 owner，"你看看"
   ▼
[4] owner 看 preview（在浏览器 / Claude Code 文件预览里都行）
   │
   │   不满意 → "改一下，重点写 GraphQL 那段" → 回到 [3]，Claude
   │           refine resume_content → resume.draft(...) 出新 draft
   │           （旧 draft id 可以保留或 Claude 主动 discard）
   │
   │   满意 → "发吧"
   ▼
[5] Claude → applications.commit(draft_id)
   │      ── StandMeet ──
   │      │ a) 从 resume_drafts 读 content；从 Redis 池子读 job snapshot
   │      │ b) 写 applications 行（job_snapshot + resume_content 都进表）
   │      │ c) auto-issue 一条 AccessCode：
   │      │     label = "{title} @ {company}"
   │      │     purpose = "applied {date} via {source_kind}"
   │      │     tags = resume_content 里的 keywords ∪ JD 关键词
   │      │           （Claude 在 commit 入参里给）
   │      │     expires_at = now() + 180d
   │      │     max_sessions_per_member = 10
   │      │     max_turns_per_session = 50
   │      │     suggested_questions = 默认四条
   │      │ d) 渲染**正式 PDF**：layout 同 preview，QR 换成真 code 的
   │      │    deeplink → `https://<owner-domain>/<handle>?code=ABC`
   │      │    QR 位置：**右上角**
   │      │ e) 删 resume_drafts 那条 + 从 Redis 池子里 evict job
   │      │ f) 返回 {
   │      │      application_id, pdf_url, apply_url,
   │      │      next_action_hint: "下一步：用 playwright MCP 去
   │      │      {apply_url} 填表，简历传 {pdf_url}"
   │      │    }
   │      └
   │
   │ Claude 接 hint：起 Playwright，去 apply_url，填表 + 上传
   ▼
[6] 投出去
   │
   │ ─── 一段时间后 ───
   ▼
[7] recruiter 收到 PDF → 扫**右上角 QR** → /<handle>?code=ABC
   │  前端 detect ?code= → 不进 /gate 中转，直接 issue visitor
   │  session → 进 chat（已有逻辑）
   │
   │ AI 用 owner voice 答（已有 corpus + tag scope by tag intersection）
   │
   │ /admin/codes 里 owner 看到这条 invitation 被扫了几次、被谁问了什么
```

**决策点 L.3：staging draft → 预览 → owner 点头 → commit 这条流程必须有，不允许 "Claude 写完直接发"。**

**决策点 L.4：QR 位置 = 右上角（先前文档错为左上角，已纠正）。**

**决策点 L.5：扫 QR 来的访客落 `/<handle>?code=ABC`，前端自动起 session 进 chat，不经过 /gate 中转页（recruiter 已经表达意图，不要仪式感）。**

---

## 数据模型

### 新增表

```sql
-- 注册的 job 源
CREATE TABLE job_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  kind          text NOT NULL,        -- greenhouse / lever / ashby / remoteok / wwr / hn_hiring
  config        jsonb NOT NULL,        -- {"company":"vercel"} / {"category":"remote-back-end-..."} / {}
  label         text NOT NULL,         -- owner-friendly: "Vercel careers"
  last_fetched_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_sources_owner ON job_sources(owner_id);

-- 跨日 dedup 用
CREATE TABLE job_fingerprints (
  source_id     uuid NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  external_id   text NOT NULL,        -- per-source 稳定 id (gh.id / lever.id / hn.comment_id / wwr.guid …)
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, external_id)
);

-- 中间态草稿（owner 还没点头发）
-- 注意：drafts 也有 1d TTL，过期跟 Redis job 池子一起清。可选做法是
-- 直接把 draft 也塞 Redis 不进 PG —— 但 PG 方便 admin 列"未发的草稿"
-- 给 owner 看；如果决定 admin 这一面不开放，可以改 Redis。
-- 默认走 PG。
CREATE TABLE resume_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  job_cache_id    text NOT NULL,        -- Redis key 后半段，让 commit 时还能反查 job snapshot
  resume_content  jsonb NOT NULL,
  preview_pdf_path text NOT NULL,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '1 day',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_resume_drafts_owner ON resume_drafts(owner_id);
CREATE INDEX idx_resume_drafts_expires ON resume_drafts(expires_at);

-- 持久化的申请记录
CREATE TABLE applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  invitation_id   uuid NOT NULL REFERENCES access_codes(id),   -- 复用，不另起
  job_snapshot    jsonb NOT NULL,        -- 投的时候 job 长什么样（commit 之后源里改了也不变）
  resume_content  jsonb NOT NULL,        -- Claude 写的结构化内容
  resume_pdf_path text NOT NULL,         -- 正式版（带真 QR）的产物路径
  source_kind     text NOT NULL,
  apply_url       text,                  -- Playwright 去填表那个 URL
  status          text NOT NULL DEFAULT 'applied',  -- applied / interview / rejected / offered / withdrawn
  applied_at      timestamptz NOT NULL DEFAULT now(),
  last_status_at  timestamptz NOT NULL DEFAULT now(),

  -- ★ 日历预留位（现在不实现，calendar PR 接进来）
  next_event_at   timestamptz,
  notes           text NOT NULL DEFAULT ''
);
CREATE INDEX idx_applications_owner ON applications(owner_id);
CREATE INDEX idx_applications_status ON applications(owner_id, status);
CREATE INDEX idx_applications_next_event ON applications(owner_id, next_event_at)
  WHERE next_event_at IS NOT NULL;
```

**不要的表**：
- ~~`resumes`~~ — resume_content 就长在 applications 里，每条 application 一份独立内容
- ~~`invitations`~~ — access_codes 就是
- ~~`application_access_codes`~~ — applications.invitation_id 单字段够

**决策点 L.6：draft 走 PG（不走 Redis），方便后续如果开放 /admin/drafts 视图。**

**决策点 L.7：applications 表加 `next_event_at` + `notes` 给后续日历整合留口，但本期不实现日历功能。**

### Redis 池子

```
key:  job:{owner_id}:{job_cache_id}           value: FetchedJob JSON
                                              TTL: 86400s
```

`job_cache_id` = 短随机串（避免 Claude 在对话里看到 source 内部 id 泄露格式）。

---

## resume_content shape

借 interviewme 的 STAR project 设计：

```json
{
  "identity": {
    "name": "Sijie Wang",
    "email": "...", "phone": "...",
    "location_line": "Markham, Ontario, Canada",
    "links": [{"label": "github", "url": "..."}, {"label": "site", "url": "..."}]
  },
  "summary": "1-2 句 lead-in（每个 application 由 Claude 重写 to match JD tone）",
  "works": [
    {"title": "...", "company": "...", "location": "...", "period": {"start": "2023-01", "end": null},
     "bullets": ["..."] }
  ],
  "projects": [
    {"name": "Lucerna",
     "situation": "...", "task": "...", "action": "...", "result": "...",
     "supplementary": "（optional：tech stack 或 metric）"}
  ],
  "educations": [{"school": "...", "degree": "...", "period": {...}}],
  "skills": [{"category": "languages", "items": ["Go", "TypeScript", "Python"]}, ...]
}
```

Claude 每次按 JD 重写 `summary` + 调整 `works.bullets` 顺序 + 选哪几个 `projects` 上 + `skills` 列表排序。**identity 段几乎不变**（除非 owner 自己改 corpus）。

**决策点 L.8：resume_content 用 JSON 不用 markdown —— ATS 解析靠 PDF text layer，PDF 渲染端按 JSON 排版能产 deterministic 输出。**

---

## PDF 渲染

- **库**：`github.com/signintech/gopdf`（pure-Go，vector PDF，文字可选可搜，
  ATS 能解析；同时支持 unicode + TrueType embedding）。最初 doc 草案写的
  `react-pdf` 是 JS 库，跟 Go backend 不搭，改用 gopdf 保持单一语言栈。
- **QR**：`github.com/skip2/go-qrcode` 服务端生成 PNG byte slice → 直接
  embed 进 gopdf 页面。
- **layout**：固定一个版本，**简单**。单栏，serif 正文（Source Serif），
  mono 标签，**无图标无 sidebar 无 photo**。
- **不用**：`html2canvas` + `jspdf`（interviewme 那条路 —— 产 image-PDF，
  ATS 看不见文字）；headless chromium / wkhtmltopdf（额外依赖）；React PDF
  sidecar (Node service 加部署复杂度，没有真实收益)。
- **QR 位置**：右上角，~24mm × 24mm。
- **URL 编码**：`https://{owner-public-url}/{handle}?code={access_code}`

**决策点 L.9：不做模板选择，不做 LayoutConfig。一个 layout 一套字体，永远。**

---

## 前端 `?code=` 落地行为

`/<handle>` page (现有 PublicPage) 加 `useSearchParams` 检测 `?code=`：

```ts
const searchParams = useSearchParams();
const code = searchParams.get('code');

useEffect(() => {
  if (code) {
    // 直接 issue session，不进 /gate
    void fetch('/api/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ handle, code, visitor_name: '(from invitation)' }),
    }).then(...).then(() => navigate to chat-active state);
  }
}, [code]);
```

不要在 URL bar 留 `?code=` —— session 起来之后 `replaceState` 把 code 抹掉（避免 recruiter 转发 URL 给同事时 code 泄露）。

**决策点 L.10：session 起来后用 history.replaceState 把 `?code=` 抹掉。**

---

## MCP tool surface

```
# 阶段 1
jobs.register_source(kind, config, label) → source_id
jobs.list_sources()                        → [{id, kind, label, config, last_fetched_at}]
jobs.fetch_new(source_id?, since_hours?=24) → [headline row: cache_id, ttl_remaining_seconds, new]
jobs.show(job_cache_id)                    → FetchedJob (full JD)
jobs.discard(job_cache_id)                 → ok
jobs.unregister_source(source_id)          → ok

# 阶段 2
resume.draft(job_cache_id, resume_content, tags_for_invitation?)
                                           → {draft_id, preview_pdf_url, ttl_remaining}
resume.update_draft(draft_id, resume_content)
                                           → {draft_id, preview_pdf_url}
resume.discard_draft(draft_id)             → ok

# 阶段 3
applications.commit(draft_id)              → {
                                               application_id, pdf_url, apply_url,
                                               next_action_hint: "用 playwright MCP ..."
                                             }
applications.list(status?)                 → [{id, job_snapshot.title, ...status, applied_at, next_event_at, notes}]
applications.show(id)                      → full record + invitation stats (扫过几次 / 几次 chat)
applications.update_status(id, status, next_event_at?, notes?)
                                           → ok
```

**决策点 L.11：Playwright 衔接靠 `next_action_hint` 字段嵌进 commit 响应，不做单独 tool。**

**决策点 L.14（2026-08-20，F-E-29 驱出来的）：`jobs.fetch_new` 交的是「池子这个窗口的整块板子」，
不是「这一趟新捞的那几条」。** 两件事跟着定死：

- **列表只发标题级字段**（cache_id / title / company / location / url / tags / published_at /
  ttl_remaining_seconds / new），**不发 body_text**。一天两三百条真岗位、每条正文一两千字，
  全塞进回执就把 owner 那一侧的上下文烧光；挑中的那几条再 `jobs.show` 读全文。
  这也是这张表里 `fetch_new` 和 `show` 一直分开列的原因。
- **`new=true` 表示这一趟才进池子的**。于是「今天的板子长什么样」和「跟上次比多了什么」
  由同一个列表回答，owner 一天里问第二次不会拿到空数组。
- **跨源去重同时作用在池子这一面**（池子按源写，重复的那条物理上有两份），
  判谁先赢按**入池先后**。`/admin/listings` 跟这条路读同一个 `jobsuc.ListPoolBoard`，
  两个面不可能给出不同的板子。

---

## 已申请视图（/admin/applications）

列表，每行：
- status badge (`applied` / `interview` / `rejected` / `offered` / `withdrawn`)
- "{title} @ {company}" + source kind 小字
- applied 时间
- **next_event_at**（如果有）—— 现在 owner 手动填，未来日历自动填
- invitation 入口链接 → /admin/codes 看那条码扫了几次、被聊了什么
- resume PDF 下载
- apply_url 外链

筛选：status / source kind / 日期范围

**未来日历整合接入位**：每条 application 行有 `next_event_at`，calendar PR 来的时候会：
1. 把 application 当 calendar event source 之一
2. owner 在 admin /calendar 看到聚合视图
3. 接 ICS 输出或 Google Calendar push（再议）

**决策点 L.12：本期不做日历，但 applications.list 返回 `next_event_at`，UI 已经显示这一列（手动填）。**

---

## 阶段拆分跟实现顺序

详见 task #80–#84。
- #80 Phase 1：jobs.* + 6 个 fetcher + Redis TTL 池子
- #81 Phase 2：resume.* + react-pdf 渲染 + STAR shape
- #82 Phase 3：applications.* + auto-issue invitation + 右上角 QR + `/<handle>?code=` 前端逻辑
- #83 Phase 4：next_action_hint 引导 playwright（不做独立 tool）
- #84 把愿景写进 CLAUDE.md mirror

依赖：80 → 81 → 82。83 可以跟 82 同时做（同一个 commit 响应字段）。84 任何时候都能做。

---

## Open questions（先记着，不阻塞实现）

- **resume_content "种子"**：第一次 owner 投第一个 job 之前，corpus 里可能没有 work history（owner 还没通过 raw_dump 喂进自己的简历素材）。是否要个 `resume.seed_identity()` MCP tool 让 owner 一次性把基础 identity 灌进 wiki？或者让 Claude 第一次 draft 时主动问 owner 缺什么然后让 owner 在对话里口述 → Claude 用现有 raw_dump 落 corpus。**倾向后者**，不开新 tool。

- **draft 跟 job 池子的耦合**：draft 表的 `job_cache_id` 指 Redis 池子，过期了 commit 会失败。两种处理：
  - (a) draft 创建时立刻把 job snapshot 复制进 draft 行 → commit 时直接用 draft 里的 snapshot
  - (b) 保持现状，commit 时如果 Redis miss 报错让 owner / Claude 重 fetch
  - **倾向 (a)** —— 数据冗余但行为 robust，draft 跟 job 池子解耦。**决策点 L.13：draft 创建时 snapshot job 进 draft 行。**

- **invitation 反向追踪**：owner 想知道"我投 Vercel 那条码被扫了没"。已有 /admin/codes 看到每条 code 的 member 列表。**够用**，不另起 reporting。

- **撤回**：owner 想撤回一份 application（比如已经接了别家）。需求是：(a) 标记 status=withdrawn (b) revoke invitation。`applications.update_status(id, 'withdrawn')` 内部 cascade 调 `revoke code(invitation_id)`。

- **公司碰巧两次扫同一个 QR 进同一个 invitation**：access_codes 现有 `max_sessions_per_member=10` 已经管这事。

---

## 不做的事（明确划界）

- ❌ Wellfound / LinkedIn / Indeed 的 server 端 scrape（反爬 + TOS + 法律）。如果以后要做 LinkedIn，走 owner-side browser 扩展（owner 自己的 cookie 自己 session），不进 StandMeet server。
- ❌ resume 模板选择 / 排版自定义。一个 layout 永远。
- ❌ cover letter 单独 artifact。如果需要 cover letter，Claude 写完直接给 Playwright 填进 application form 的 textarea；StandMeet 不存 cover letter 文件。
- ❌ "为我自动 daily fetch jobs" 定时任务。fetch 是 on-demand 的（owner 在 Claude 里主动问），StandMeet 不蓄水。
- ❌ AI 全自动决定哪个 job 投。owner 必须看 draft 点头才 commit。
- ❌ 邮件通知 / Slack 通知 / 多端推送。已申请的 status 变化靠 owner 自己 update（或未来 calendar 拉过来）。
