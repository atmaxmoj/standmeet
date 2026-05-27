# StandMeet — Test Backlog

> 从 features-and-journeys.md 的 `[✓ 内置]` / `[ ]` / `[~]` 推导出来的完整
> spec backlog。每条是一个 e2e test case（不是文件 —— 一个 .spec.ts 文件
> 可以装多个 case）。
>
> 按状态机 / 用户流组织。每个 flow 列出 happy path + 错误流 + 边界 + 状态
> 切换。标 `[done]` 表示已有 spec 覆盖；空的就是要补的。
>
> 现状：63 个 spec 文件 / 92 个 test case。下面列的是全覆盖目标。

---

## 1. Visitor Session 状态机

### 1.1 Code-tier session

**Happy path:**
- [done] QR 扫码进 `/?code=ABC` → absorb → URL 清 → SessionStrip 出现 (qr-code-absorb)
- [done] gate 手动输 code → submit → ChatRoom (gate-access)
- [ ] paste code → 自动 submit → ChatRoom（不用点 enter）
- [ ] QR 扫码 → VisitorNamePicker 弹出 → 填名 → ChatRoom welcome 带名字
- [ ] QR 扫码 → VisitorNamePicker → skip → ChatRoom welcome 无名字（"anonymous"）

**Error flows:**
- [done] 无效 code → error 提示 (qr-code-absorb invalid case)
- [ ] 过期 code → "code expired" 提示 + 引导 /gate#request
- [ ] 已 revoke 的 code → "code revoked" 提示
- [ ] 空 code 提交 → 按钮 disabled / 不触发
- [ ] 网络断 → session 创建失败 → 友好 error message（不是 raw stack trace）

**State transitions:**
- [ ] session active → 刷新页面 → session 从 localStorage 恢复 → 仍在 ChatRoom
- [ ] session active → 点 "exit session" → 回到 long-scroll
- [done] session active → SessionStrip 显示 code 标签 + gauge (session-strip)

### 1.2 BYOAI session

**Happy path:**
- [done] gate BYOAI panel → 填 provider + key → submit → ChatRoom BYOAI mode (byoai-chat)

**Error flows:**
- [ ] BYOAI 空 key 提交 → 按钮 disabled
- [ ] BYOAI key 格式错 → client-side 提示
- [ ] BYOAI key 在 chat 中途失效（4xx from provider）→ error turn + 引导 re-enter
- [ ] BYOAI visitor 问 private topic → "need a code" 响应（不是报错）

**State transitions:**
- [done] BYOAI → SessionStrip 紫色 "visitor-paid · unlimited" (session-strip)
- [ ] BYOAI → 刷新 → session 恢复 → 仍在 ChatRoom BYOAI mode
- [ ] BYOAI → exit → 回到 long-scroll

### 1.3 Cross-tab sync

- [ ] Tab A 输 code login → Tab B storage event → SessionStrip 同步出现
- [ ] Tab A exit session → Tab B SessionStrip 消失
- [ ] Tab A quota 用尽 → Tab B composer 锁

### 1.4 Quota 状态机

- [done] turns < max → composer 可用 (turn-quota)
- [done] turns = max → composer locked + "session full" (code-quotas)
- [ ] turns 到 80% → SessionStrip 变 warn（accent 红）+ "request more ↗" 出现
- [ ] quota 用尽 → 新消息不发 + 友好提示（不是 silent 无反应）
- [ ] max_turns = 0（无限制）→ 永不 lock
- [done] per-member quota 累计 (member-quotas, quota-accumulation)
- [ ] owner 改 quota 值 → 下次 session 生效
- [ ] code revoke → 现有 session 立即锁？还是 grace period？

---

## 2. ChatRoom 状态机

### 2.1 ChatRoom layout 切换

- [ ] public visitor (no session) → 看到 long-scroll（Hero + Insights + Projects + Where + Contact）
- [ ] coded visitor → 看到 ChatRoom（slim header + welcome + composer）—— 不看到 long-scroll
- [ ] BYOAI visitor → 看到 ChatRoom（BYOAI mode welcome）
- [ ] ChatRoom → 点 "full page →" → 切到 long-scroll？还是新 tab？
- [ ] long-scroll visitor 提问后 → ConversationDeck 出现 + scroll to answer

### 2.2 ChatComposer

- [ ] starter chips 渲染（coded: 3 starters / BYOAI: 2 starters）
- [ ] 点 starter chip → 自动发送 → chip 消失（showStarters = conv.length > 0）
- [ ] 手动输入 → ask ↵ → turn 渲染 → "retrieving ···" → answer 渲染
- [ ] pending 状态 → input disabled + submit 灰
- [ ] exhausted → "session full" 替换 "ask ↵"
- [ ] 快速连续提交 → pending 锁防重发

### 2.3 ChatWelcome

- [ ] coded mode → 显示 code label + scope 说明 + "ask anything"
- [ ] BYOAI mode → 显示 provider name + "public slice only"
- [ ] coded + 有 visitor name → "Hi, {firstName}"
- [ ] coded + 无 visitor name → "Hi"

### 2.4 Turn rendering

- [ ] normal answer → serif body paragraphs + "ai" speaker label
- [ ] answer with citations → "drawn from" block 出现
- [ ] answer with ToolCallBlock (calendar) → slot grid 渲染
- [ ] answer with ToolCallBlock (file) → download pill 渲染
- [ ] pending → "retrieving ···" 动画
- [ ] error → error message 渲染（不是空白）
- [ ] reset → 所有 turns 清空 + welcome 重现

---

## 3. Gate 状态机

### 3.1 Code panel

- [done] 正确 code → redirect to / (gate-access)
- [ ] paste code → 大写归一 + 非 [A-Z0-9-] 过滤
- [ ] 错误 code → shake 动画 → 清空 → refocus
- [ ] "checking…" 状态 → submit 后按钮文案变
- [ ] code + name 一起提交 → session 带 visitor name

### 3.2 BYOAI panel

- [done] 4 字段填完 → submit → redirect (byoai-chat)
- [ ] 缺必填字段 → submit disabled
- [ ] provider 切换 → endpoint/model placeholder 变

### 3.3 Request access form

- [done] 填 email/name/org/message → submit → "sent" 状态 (gate-access)
- [ ] 空 email → 不让提交
- [ ] 重复提交 → disabled 防重发
- [ ] 提交后 → collapsible "sent, we'll get back to you"

---

## 4. Blog 状态机

### 4.1 Blog index

- [done] 有 posts → cover card grid 渲染 (blog-posts)
- [done] infinite scroll → 加载更多 (blog-posts)
- [ ] tag filter → 点 tag → 只显示该 tag 的 posts
- [ ] tag filter → 再点同一 tag → 清空 filter（all）
- [ ] 0 posts → empty state
- [ ] AskCorpusCTA → 点 "open the chat →" → 跳到 /
- [ ] RecommendedRail → "if you only read two" → 显示前 2 篇 + 可点击

### 4.2 Blog article

- [done] public post → cover + header + body + backlinks (blog-posts, blog-crosslinks)
- [done] AskAboutThis → starter prompt → /?q=... (ask-about-this)
- [ ] private post + 没 code → LockedView（teaser + request CTA）
- [ ] private post + 有 code (scope 匹配) → 正常渲染
- [ ] crosslink [[slug]] → 渲染为链接 + 可点击跳转
- [ ] broken crosslink [[不存在的slug]] → 渲染为纯文本（不报错）
- [ ] XSS body → 不执行（已有但验证深度）

### 4.3 FloatingChatDock

- [ ] blog index → 右下角 pill 可见（有 session 时）
- [ ] 无 session → pill 不渲染
- [ ] 点 pill → 面板展开 → input 可见
- [ ] 输入 → ask → answer 渲 → transcript 在面板内滚动
- [ ] 关闭面板 → pill 恢复
- [ ] 跨页面保持（blog → wiki → pill 仍在）

---

## 5. Wiki / Output Landing 状态机

### 5.1 Wiki landing

- [done] public wiki → breadcrumb + body + TrustBox (wiki-landing)
- [ ] cover hero 渲染（title + date）
- [ ] private wiki + 没 code → LockedView（"requires access code" + gate link）
- [ ] private wiki + 有 code (scope 匹配) → 正常渲染
- [ ] AskAboutThis (kind=wiki) → /?q=... 跳到 chat
- [ ] 不存在的 slug → 404

### 5.2 Output landing

- [done] public output → breadcrumb + TrustBox (output-landing)
- [ ] cover hero + PDF preview card 渲染
- [ ] gated output + 没 code → LockedView
- [ ] gated output + 有 code → 正常渲染
- [ ] AskAboutThis (kind=output) → /?q=...
- [ ] 不存在的 slug → 404

---

## 6. Admin Dashboard 状态机

- [ ] owner 登录 → dashboard 是默认 landing
- [ ] 4 KPI cards 显示真实数据（entries / unprocessed / codes / requests）
- [ ] sparkline SVG 渲染 14 天曲线
- [ ] "needs your hand" → requests > 0 → "review →" 链接可点
- [ ] "needs your hand" → raw unprocessed > 0 → "open →" 链接可点
- [ ] "needs your hand" → drafts reviewing > 0 → "review →" 链接可点
- [ ] 全部 0 → "nothing pending" 空态
- [ ] recent visitors → 显示最近 5 条 conversation
- [ ] jobs heat → sent 计数来自 /api/admin/applications/
- [ ] jump 链接 → 点击跳到对应 admin section

---

## 7. Admin Sidebar 状态机

- [done] 6 group 渲染 + active 高亮 (admin-auth-guards)
- [ ] badge: raw unprocessed > 0 → badge 数字出现
- [ ] badge: requests new > 0 → badge 数字出现
- [ ] badge: 数据变化 → 60s 轮询刷新 badge
- [ ] 点 nav link → section 切换 + active 移动

---

## 8. Admin Corpus CRUD 状态机

### 8.1 Raw

- [done] list + filter (corpus-crud-ui)
- [ ] DumpBox → 选 source chip → 输入 → dump → 新行出现在 list
- [ ] filter 切换（unprocessed / flagged-private / promoted / all）→ list 过滤
- [ ] promote → wiki modal → 填 title + tags → confirm → raw 变 "promoted"
- [ ] archive → raw 消失（或标 archived）
- [ ] 编辑 body → save → body 更新
- [ ] media metadata 渲染（有 media 的 entry 显示 kind · label）

### 8.2 Wiki

- [done] list + create + edit + delete (corpus-crud-ui)
- [ ] tag filter → 点 tag → wiki 列表过滤
- [ ] excerpt 段落 → 显示 body 截取前 200 字符
- [ ] visibility dot → public 灰 / private accent
- [ ] promote to output → output 列表出现新条目
- [ ] SEO 编辑 → slug / description / indexed toggle

### 8.3 Output

- [done] list + create + edit + delete (output-promotion)
- [ ] cover strip hue gradient 渲染
- [ ] tier pill（public / unlisted / private）正确渲染
- [ ] views / downloads stats 显示
- [ ] dual create buttons（pdf / web essay）

---

## 9. Admin Conversations 状态机

- [done] table 渲染 + transcript modal (conversations-per-code)
- [ ] sentiment 列 → 根据 turn count 显示正确标签（short / curious / warm / engaged）
- [ ] BYOAI conversation → sentiment = "shopping"
- [ ] private_hits > 2 → sentiment = "probing"
- [ ] 点击 row → transcript 展开 inline
- [ ] ?code=LABEL → filter 只显示该 code 的 conversations
- [ ] clear filter → 显示全部

---

## 10. Admin Codes 状态机

- [done] create + list + quota (access-codes, code-quotas)
- [ ] 3-col card layout → members 列 + scope chips + inline QR 同时可见
- [ ] QR 点击 → QR modal / 下载 PNG
- [ ] Quota bar → 视觉进度条正确显示 used/max
- [ ] revoke → card 变灰 + "expired" status
- [ ] edit code → 改 label / scope / quota → save → card 更新
- [ ] "view conversations →" → 跳到 conversations?code=XXX

---

## 11. Admin Requests 状态机

- [ ] open request → "approve · issue code →" 按钮可见
- [ ] approve → 自动 issue AccessCode + request 变 approved
- [ ] decline → request 变 declined + reason 显示
- [ ] defer → request 变 pending
- [ ] block sender → UI 反馈（backend 未接通先验 UI）
- [ ] blockquote message 正确渲染（italic serif + left border）
- [ ] filter chips → open / replied / closed / all 切换

---

## 12. Admin Drafts + Applications 状态机

### 12.1 Drafts

- [ ] draft card → 2-col layout（content + PDF preview thumbnail）
- [ ] status pill 颜色（reviewing = amber / draft = neutral / sent = accent）
- [ ] diff-vs-master 引用块（accent left border 背景）
- [ ] reviewing → "open composer →" + "edit" + "regenerate" 三个按钮
- [ ] draft → "finish drafting →" + "discard" 两个按钮
- [ ] sent → "view application" + "view pdf" 两个按钮
- [ ] open composer → ResumeComposer 全屏 overlay 打开
- [ ] empty state → "No drafts pending."

### 12.2 Applications

- [ ] application card → 3-col footer（contact / notes / "open ›"）
- [ ] 点击 card → ApplicationDetailModal 打开
- [ ] modal → timeline 渲染（sent → opened → reviewing）
- [ ] modal → status segmented 切换（silent / reviewing / replied / rejected / offer）
- [ ] modal → notes textarea 可编辑
- [ ] empty state → "No applications sent yet."

---

## 13. Admin Connectors 状态机

- [done] ConnectorAddModal + config form (connector-add-modal)
- [ ] dashed "＋ browse the catalog" card → 点击 → modal 打开
- [ ] category tab 切换 → catalog grid 过滤
- [ ] installed connector → "● installed" pill
- [ ] config form → secret 字段 → reveal/hide toggle
- [ ] config form → oauth 字段 → "Authorize…" 按钮
- [ ] connect → tile 状态变 "● connected"

---

## 14. Admin Skills 状态机

- [done] create + list + delete (skills, skill-scripts)
- [ ] heat-bar graph → 渲染 2-col grid + gradient bar
- [ ] role label → 根据 heat 值正确显示（core / strong / maintained / developing / dormant）
- [ ] "rebuild from corpus" 按钮 → UI 反馈

---

## 15. Admin Preview 状态机

- [ ] code picker → 点 code → 右侧 preview frame 变化
- [ ] BYOAI card → 点 → "byoai mode · public scope" 显示
- [ ] coded preview → banner 显示 code label + "scoped to N topics"
- [ ] coded preview → suggested questions 显示（来自 code.suggested_questions）

---

## 16. Admin SEO / Obsidian / System

### 16.1 SEO
- [ ] defaults form → 各字段可见
- [ ] "regenerate sitemap" 按钮 → UI 反馈
- [ ] indexing stats → pages / outputs / posts 显示
- [ ] OG preview card 渲染

### 16.2 Obsidian
- [ ] vault stats 4-cell（mode / notes / size / last sync）渲染
- [ ] "import vault zip" 按钮可见
- [ ] "export corpus zip" 按钮可见

### 16.3 System
- [ ] terminal block → version / uptime 渲染
- [ ] background jobs table → 行数 ≥ 3
- [ ] health checks → status dots（ok = accent / warn = amber）

---

## 17. Setup Wizard 状态机

- [done] 4 step happy path (claim-instance, setup-wizard-4step)
- [done] password mismatch → error (setup-wizard-4step)
- [done] wrong captcha → error (setup-wizard-4step)
- [ ] step 1 → handle 非法字符 → next disabled
- [ ] step 1 → publicUrl 非 http → next disabled
- [ ] step 3 → 选 provider → key 字段 placeholder 变
- [ ] step 3 → ollama 选中 → key 字段隐藏（needsKey=false）
- [ ] back 按钮 → 回到上一步 → 数据保留
- [ ] step 1 不填 → next disabled（realtime）

---

## 18. Login 状态机

- [done] 正确凭据 → /admin (owner-login)
- [done] 错误密码 → error 提示 (owner-login)
- [ ] 空 email → submit disabled
- [ ] 空 password → submit disabled
- [ ] 连续失败 → throttle 提示
- [done] forgot password → reset flow (password-reset)

---

## 19. Cross-feature 集成

### 19.1 Job loop 端到端

- [ ] register source → fetch_new → listings indexed → shortlist → resume.draft → open composer → edit → send → applications.commit → auto code issued → QR on PDF → recruiter 扫码 → ChatRoom → owner 在 conversations 看 transcript

### 19.2 Corpus pipeline

- [ ] raw_dump (MCP) → raw list 出现 → promote to wiki → wiki list 出现 → wiki SEO landing 可访问 → promote to output → output list 出现 → output SEO landing 可访问

### 19.3 Code → chat → transcript

- [ ] owner 创 code → visitor 用 code 进 ChatRoom → 聊几轮 → owner 在 /admin/conversations 看到 transcript + sentiment + cited bodies

### 19.4 Blog → chat flow

- [ ] owner 发 blog post → visitor 在 /blog 看到 → 点开文章 → AskAboutThis → /?q=... → ChatRoom 自动 ask → answer 引用 corpus

---

## 统计

| 分类 | done | 要补 |
|---|---|---|
| Visitor session | 6 | 18 |
| ChatRoom | 0 | 18 |
| Gate | 3 | 9 |
| Blog | 4 | 10 |
| Wiki/Output landing | 2 | 10 |
| Admin dashboard | 0 | 10 |
| Admin sidebar | 1 | 4 |
| Admin corpus CRUD | 3 | 12 |
| Admin conversations | 1 | 6 |
| Admin codes | 2 | 6 |
| Admin requests | 0 | 7 |
| Admin drafts/applications | 0 | 12 |
| Admin connectors | 1 | 6 |
| Admin skills | 1 | 3 |
| Admin preview | 0 | 4 |
| Admin SEO/obsidian/system | 0 | 9 |
| Setup wizard | 3 | 5 |
| Login | 2 | 3 |
| Cross-feature | 0 | 4 |
| **总计** | **29** | **~156** |

现有 92 个 test case 覆盖约 29 个状态路径。完整覆盖需要 ~156 个新 case。
