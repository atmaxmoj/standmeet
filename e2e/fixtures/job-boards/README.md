# Job board fixture snapshots

真实 API 在 **2026-05-20** 抓的快照，每个 source kind 多家公司覆盖。

每个 fixture 文件 = `{source_kind}/{slug}.day{n}.{ext}`：
- `slug` = 这个源里识别该 board 的 key（Greenhouse 的 company name、Ashby 的 board slug、WWR 的 category 等）
- `day{n}` = 同一 board 不同时间点的两个 snapshot，用于 dedup test（fetch_new 应该只返回 day2 里 day1 没出现过的 id）
- `ext` = `json` / `rss`

## Inventory

| Source | Files | Notes |
|---|---|---|
| **greenhouse/** | 25 | airbnb, stripe, vercel, figma, anthropic, dropbox, instacart, pinterest, reddit, gusto, duolingo, elastic, gitlab, cloudflare, datadog, mongodb, mercury, chime, brex, lyft, robinhood, asana, affirm, fivetran, samsara (?) |
| **lever/** | 4 | leverdemo, highspot, jobvite, palantir |
| **ashby/** | 4 | Ashby, Linear, Notion, posthog, supabase |
| **remoteok/** | 1 | api (aggregate feed) |
| **wwr/** | 10 | 全部 10 个 category RSS |
| **hn/** | 10 | whoishiring (user) + item-47975571 (May 2026 thread) + 8 真 postings |
| **smartrecruiters/** | 1 | visa (v1.1 source) |
| **workable/** | 6 | typeform, mux, marshmallow, intercom, mistralai, rechargehq (v1.1 source) |

各 fixture 都 trim 到 ≤ 8 jobs / 8 items，**保持原 API 响应 shape 不变**。完整未 trim 的捕获放在 `.raw/`（gitignore'd）。

## Day2 fixtures

dedup test 需要 `*.day2.{json,rss}` —— 同 board，**新加几条 + 删几条** 来模拟一日后的状态变化。生成方式：

```bash
make gen-day2-fixtures
```

逻辑（per kind）：
- Greenhouse / Ashby：`.day1.json` 的 `jobs[0:8]` → `.day2.json` 取 `jobs[2:10]`（前 2 条"消失"，多 2 条"新增"）
- Lever：`.day1.json` 是数组直接 slice [2:10]
- RemoteOK：array[0] legal notice 保留 + [3:11]
- WWR：item-3 之后保留 + 增 2 个虚构 item（GUID 改了 pubDate）
- HN：`whoishiring.day2.json.submitted[0]` 指向"新月份"的 fake item ID；fake item-{id}.day2.json 含 5 个新 comment IDs

day2 是**合成的**，从 day1 派生，不再次访问真 API。这避免了真 API 随时间漂移把 day1 → day2 的预期 diff 弄乱。

## 重新抓 / 刷新

每季度跑一次（或字段 schema 怀疑漂移时）：

```bash
make capture-job-fixtures   # 重抓 raw → .raw/
make trim-job-fixtures      # 把 raw 截到 8 条 → 当前路径
```

`make capture-job-fixtures` 是 `e2e/fixtures/job-boards/capture.sh` 的 wrapper，per-kind 列表写在脚本里。

User-Agent 一律是 `StandMeet-fixture-capture/0.1 (+https://github.com/wangsijie/standmeet)` —— 用于真 API 礼貌识别。

## 哪些 board 抓不到（明确划界）

- **SmartRecruiters** 大部分 public 公司返空（API 接受 slug 但 totalFound=0），只有 visa 有公开 listings。SR 在 v1.1，cohort 暂时够。
- **Workable** 用 `widget/accounts/{sub}` endpoint 返**账户 metadata**（name + description），**不返 jobs**。要真 jobs 列表得用别的 endpoint —— 实现 Workable adapter 时再确认。
- **Wellfound / LinkedIn / Indeed** —— 不抓，server 端不该跑这些（见 docs/design/job-loop.md 不做明示）。

## Day1 → Day2 状态期望（spec assertion 用）

| Board | day1 ids | day2 ids | 差集 (day2 - day1) |
|---|---|---|---|
| greenhouse/airbnb | [a,b,c,d,e,f,g,h] | [c,d,e,f,g,h,i,j] | {i, j} |
| ashby/Notion | [a,b,c,d,e,f,g,h] | [c,d,e,f,g,h,i,j] | {i, j} |
| ... | ... | ... | ... |

（gen-day2 脚本生成时把每个 board 的"前 2 个消失 + 后 2 个新增"具体 IDs 写到一份 manifest，e2e 直接 import 这个 manifest 作断言数据，不在 spec 里硬编码）
