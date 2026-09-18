# StandMeet Roadmap —— 大块级

> **视角:** 这份文档只写**大块(major blocks)**——"要建的下一件大事"。颗粒度小的具体项在 task tracker 里,不重复。
> **来源:** 综合 `~/Develop/writing/notes/wiki/software/project/standmeet/`(owner 的设计 vault)+ 现有代码实况。vault 里很多 seed **本身没落地设计**(有的打了 🚧,有的没打),所以每个大块要动手前,都得像 connector 那样**先出一版 design + tests**,再写。
> **状态图例:** ✅ 建好 · 🟡 部分建 · ⬜ 没建 · 🚧 = vault 里标"设计在飞、未落地"。

---

## 块一 · corpus = Obsidian vault(产品核心承诺,最大且最散)

一句话:**owner 在 Obsidian 写 → StandMeet 同步 → StandMeet 是这套 portable markdown 的另一个 renderer,把 curated 的图服务给访客。** 这直接兑现 product hub 的"author in Obsidian, sync to StandMeet"、thesis(AI 对话→curated corpus)、differentiation("a personal site, but conversational" + owner 亲手织的图 = relevance signal)。

corpus 数据形态**已经就是 vault**:三级 promotion(raw→wiki→output)、derived-path(parent_id 树,reparent 免费,无 path 列)、backlinks 声明式重建边表(`wiki_refs`/`writing_refs`)。所以大块一不是"重建 corpus",是"**把 vault 的三个面(喂图/爬图/渲染)补齐**"。

### 1a · 同步侧(喂图) ✅ 机制建齐(2026-09 重写为多 genre sync,取代原 writings-only 最简版)
- ✅ **多 genre `SyncVault`**:vault 顶层文件夹按 genre 路由进 `corpus_notes` 节点树(`backend/internal/corpus/obsidian/sync.go`,`corpGenres = {wiki, subjectivity}` + raw)。writings 一层另有 export(zip)/import 手动批量。**output 无对应文件夹**——它是 promote-derived,不从 vault 喂,是设计如此不是缺口。
- ✅ **folder-note 折叠已实现**:`basename(file)==basename(dir)` → 该文件是 folder note,node path = 目录路径(`sync_tree.go` `nodePathFor`);中间段缺 folder-note 自动补空占位。
- ✅ **open question 已答**:wiki 的 `parent_id` 从 vault 文件夹树推(folder tree → node path,同 `nodePathFor`)。
- 覆盖:sync-a…sync-k / sync-authoritative-prune / sync-e-links / note-refs-unified 等 e2e;唯一自认缺口 = importer 与 vault 自带脚本对齐(`#107` 拿真实本地 vault 手动验证)。
- 相关具体项:`#151`(raw 分级/层级)、`#113`(`seo_indexed`→`published`,跟 vault `publish` 闸对齐)、`#114`(landing/reader 拆出)。

### 1b · 检索侧(爬这张图) 🟡
- ✅ `corpus_search`/`_read`/`_list` over Postgres 全文检索;`corpus_map` 导航**只爬树**(parent_id)。
- 🟡 **爬网(graph retrieval)**:**1-hop 边walk已建**——`corpus_links` 顺 `note_refs` 出边 + 入边(backlinks),per-neighbor ACL(`corpus/usecase/corpus_lister_pg_links.go` `Links()`;工具 `corpus_links`/`corpus_map`/`corpus_grep`)。agent 想深入就对 neighbor 再调一次。**仍未做**:server 端 bounded-depth BFS + 跟全文检索合并排序。
- → **设计 + 红先行测试计划已出**:[`docs/design/corpus-graph-retrieval.md`](corpus-graph-retrieval.md)(新 `corpus_walk` 工具/host_op:seed via Search + note_refs 扩展 + 每跳 ACL + fused rank)。
- **决策已定**:**故意不用 vector/pgvector**——相关性 = owner 写的 `[[链接]]`,不是模型猜的语义距离。
- 落地设计要补:BFS 深度/排序上限、ACL 怎么进 query(别爬到 role 不可见的 entry)、跟全文检索怎么合。
- 相关:`#150`(output backlinks——output/writings 得跟 wiki 一样有边表,图才连得起来)。

### 1c · 渲染对称(两侧同源) 🟡
- ✅ KaTeX + Mermaid(D-6)。
- ✅ **Callout `> [!theorem]`**:`markdown-callouts.ts`(手写 mdast walk,不引 unist-util-visit)把 `> [!type] Title` blockquote 转成 `blockquote.callout[data-callout=type]` + `.callout-title`(DOM 对齐 Obsidian);接进 ChatMarkdown pipeline(wiki/output/restricted),`data-callout` 进 rehype-sanitize 白名单,`.callout` base 样式走 design palette、owner 可按 type 覆盖。**截图验证过**(theorem / warning 两个 callout 框正常渲)。
- ✅ **TikZ 精确数学图**:` ```tikz ` → node-tikzjax(= obsidian-tikzjax 同引擎,两侧一致)server 端渲 SVG,client lazy fetch(重 WASM 不进客户端 bundle)。serverExternalPackages + outputFileTracingIncludes 把 TeX 运行时资产(core.dump.gz 等)带进 standalone;25s fail-fast 降级。**RED→GREEN**(render-tikz)。
- ✅ **`standmeet-widget` 沙箱 iframe 块(v1)**:fenced block 内 JSON descriptor(src/height/sandbox)→ sandboxed `<iframe>`;sandbox 默认最小 `allow-scripts`(不给 allow-same-origin);mount-guard → `seo:false`(客户端才挂,不进 SSR/索引);畸形降级。**RED→GREEN**(render-widget)。**postMessage 协议(render-data/resize/requestCapability)+ per-block ACL 后置**——留作独立设计一轮(跟 MCP Apps `ui://` 渲染器统一)。
- ✅ **同步 owner 的 Obsidian CSS snippet**(2026-07 owner 决策,**改了原"never import CSS"设计**):`.obsidian/snippets/<enabled>.css` 同步进来当 StandMeet 页面 CSS,"两侧长得一模一样"。三点全落地:(a) vault-ingestion 给 `.obsidian/snippets/*.css` + `appearance.json` 开 harvest 白名单(不再"点前缀全忽略");(b) **sanitize**——剥 `@import`/外部+js `url()`/`expression()`/`-moz-binding`、scope 每条选择器到 `.corpus-content`;(c) 三面(vault-sync / admin PUT `/appearance/css` / MCP `set_owner_css`)写同一 `owners.custom_css`;**外加 per-note `cssclasses` frontmatter 呈现钩子**(三面写、corpus_read 返回)。owner-css-* / cssclasses-surfaces / sync-g-hidden 全绿。
  **真渲染已接(这才算完,不是只后端绿)**:公开 `GET /api/v1/appearance.css`(text/css) 由 reader `<link>` 引(真 stylesheet 资源,非 inline `<style>`);`CorpusContent` 两层——`.corpus-content` 作 scope 锚点、per-note cssclasses 放内层 div(这样 owner 的 `.theorem{…}` 被 scope 成 `.corpus-content .theorem` 能命中)。wiki/output/writings/restricted 四个 reader 面全接。**截图逐个看过**(owner snippet 改 h2/blockquote/code、`.boxed` 画框、callout)。之前那个 ✅ 是只做了后端存/读没接前端渲染时早标的,现已补齐渲染。

### 1d · Obsidian 生态借力(不 host 插件,借它的 output/code/信号) ⬜
**不能在 StandMeet 里跑 Obsidian 插件**(闭源 Electron host = 那道墙;连 Obsidian 自己的 Publish 都跑不了插件)。但生态的价值三条路进来:
- **authoring helpers**(Templater/QuickAdd)→ 无需——它们只在写作时跑,留下的是 plain markdown,直接 ingest。
- **rendering**(KaTeX/Mermaid/TikZ)→ **别用插件,直接用底层库**(见 1c)。
- **Dataview 类(query)→ 原生做,而且更强**:corpus 本就是真 DB(Postgres)+ frontmatter + `wiki_refs`,可以跑 Dataview 式查询,比 Dataview-over-files 强。✅ **已建"corpus 查询"**:note body 里 ` ```standmeet-query ` fenced block(genre/tag/children-of/sort/limit DSL)在 corpus_read 时服务端解析成活的 `[[Title]]` 列表,ACL by construction(走 reader 自带的 grantedGlobs,owner-only genre 不泄漏)。query-render / query-acl / query-errors 全绿。
- **真需要插件时 → owner 侧 export 预渲染**(Dataview Publisher / Digital Garden 那套,把动态烤成 static markdown),StandMeet ingest 烤好的结果。这也正是 Obsidian Publish 自己的解法(浏览器 app,只活 core 渲染 + `publish.css`)。
- **Execute Code(Jupyter 式)**:owner 侧照跑;显示 code+output → 把 output 存进 note 再 ingest;**若要在服务页上 live 执行 → 复用 StandMeet 自己的硬化 sandbox**(`skill_run_script`/`internal/sandbox`:bwrap + `--network=none` + 白名单),别抄 Execute Code 的"本机无沙箱"模型(#5 isolation)。

### 1e · 同步的形态(现状 vs 设计) 🟡
- 🟡 现在是 **bespoke endpoint**(`routes/admin/obsidian.go` 两个按钮 export/import),独立于 connector。
- 设计(决策点 **P.9**)说:**connector 分 action / sync 两模式,同一抽象,「Obsidian = sync」**。→ 未来可把 vault 同步**归一成一个 sync-mode connector**(跟 calendar/mail 同一套 connector 底座,ingest 而非 action)。归一与否是块一/块二的**接缝**。
- 相关:`#107`(拿你**真实本地 vault** 手动验证)、`#108`(真实外部服务验证方案——没法 e2e 的那类)。

> **块一小结**:数据(树+边)全现成,决策(非 vector / portable / per-host 但可选同步 owner CSS / 不 host 插件而借 output)全 settle,**风险局部,不牵一发动全身**。

---

## 块二 · 平台架构 #135(三层:A–H 机制 / "替换"迁移 / driver)

终点态(设计文档):**core = corpus + visitor chat + AccessCode + PDF + AI provider + 一个插件装载器,零能力**;`MustRegister` + 进程内 registry **全删**;每个能力迁成独立标准 MCP server。这块要拆成**三层**看,别混:

### 层① · Phase A–H(机制) —— 基本 ✅,只剩 Phase D
> 注意:A–H 是**实现分期**(在 task/tests 里),设计文档本身用决策点 P.1–P.13。

| Phase | 是什么 | 状态 |
|---|---|---|
| **A**(C0+C1–C4) | 先写全红测试 → PluginManifest / mcpclient stdio+transport / pluginCapability 泛化 / boot 发现接 composition root | ✅ `#146/#136-139` |
| **B** | connector 层(Nango-proxy) | ✅ `#140`(本 session 审干净、146/146) |
| **C** | skill = Agent Skills(SKILL.md + 渐进加载) | ✅ `#141`(~90%,最轻) |
| **D · 解散** | ACL 已成(session 建立时发现过滤);观察器 = 设备/系统可观测面(小 Zabbix);secret-scan 并进 connector(B) | ✅ `#101` 观测面已真实(gopsutil host disk/mem/load + cgroup CPU/mem + 真 db/redis/storage/search ping,`cmd/server/port/sysinfo.go`);ACL/secret-scan 已归位 |
| **E** | as-MCP-server facade(聚合插件 owner 工具成单端点) | ✅ `#143` |
| **F** | MCP Apps UI(`ui://` 卡片在 chat 渲染) | ✅ `#134` |
| **(G)** | (task 里无 G,跳过/未编号) | — |
| **H** | 管理面(origin + enable/disable + admin 能力面板) | ✅ `#145` |

→ **层① 已齐**(Phase D 的 `#101` 观测面已真实,见上表)。

### 层② · "替换"迁移 —— **决策点 P.2 明写"迁移留到后期,先并存"** 🟡(eiab 2026-09 做了大半)
机制(层①)搭好后,**everything-is-a-block(2026-09-13→18)把 visitor/leaf 能力 + connector 全外置成沙箱 JS block**:`ask_visitor`/`summarize_conversation`/`calendar.book`/`corpus.retrieval`/`mail.send` + `caldav`/`smtp`/`google-calendar`/`telegram` 现在都是 `backend/blocks/*/manifest.yaml` + JS server,无 per-capability Go;`me`/`seo`/`codes` 也不再是 registry fiber,而是域 `fp.Op` 经 convergence/dispatcher 投影。`backend/internal/connector/` 已清零(0 Go 文件)。
**仍在核心(未外置)**:`jobs`/`resume`/`applications`(`owner/jobs` 的 `OwnerFibers`,仍 `MustRegister`)+ 几个 loader fiber。因此 `MustRegister`(`plugin/registry/registry.go`)+ 进程内 registry **仍在**,builtin 计数未到零(`ListByOrigin` 符号已删,origin 过滤走 `shipped.go` `Shipped()`/`OriginOf`)。feature floor(P.1c:横切 gating/state 全留 core)不得削减,每条有 spec 看守。**剩下的外置是收尾,不再牵一发动全身。**
- → **设计 + 红先行测试计划已出**:[`docs/design/layer2-externalize-jobs.md`](layer2-externalize-jobs.md)。决策 = **拆**:`jobs`/`resume` → block(`blockstore` 撑);`applications.commit` → dispatcher `fp.Op`(留 host,像 me/seo/codes 那样脱离 `MustRegister`,因为它 issue AccessCode+role 是 deterministic state holder,不进沙箱)。目标 = **核内零 Go capability fiber**(`RegisterOwnerFibers` 清空,只剩 3 个 loader)。

### 层③ · agent-as-injectable-driver —— Bridge 抽象 ✅,runtime 形态 🚧
- ✅ **Driver/Bridge 接口已抽**(`#153` agentcore 抽 Driver、`#154` eval 做成忠实 mini-host)——决策点 P.13 的结构实现落地了。
- 🚧 **还差**:把"inject-and-launch"从 test-only 提成**一等 runtime 形态** → 并行跑很多 prompt、实验出好 prompt("eval 是类型系统";prompt 被验证而非设计)。这也是 eight-controls 里缺的**"质量半"**(selection/shaping)。

---

## ~~块三 · prod 单机可部署~~ —— **砍掉**(2026-07 owner 决策)

- server + 域名 + 证书那套是 **owner 在域名/服务器供应商那边自己绑**(不是我们出 Caddy/LE 自动签证书——CLAUDE.md 里"one command + 自动 LE"愿景**作废**)。
- 我们只需**知道自己的域名**,而填写机制**已有**(owner profile `public_url` + `allowed-domains`,`routes/admin/public_url.go`+`domains.go`)。→ 等于已完成,不再是大块。

---

## 非大块(杂活清理,一轮 pass 搞定)

真独立、跟两大块无关、可穿插做:`#103`(role 卡编辑 prompt)、`#104`(per-code prompt)、`#106`(inference 计费)、`#117`(URL env prod fallback)、`#152`(mock 正名)、`#100`+`#115`(recovery phrase + 测)、`#111`(TOTP,以后)、`#126`(interview→application,job-loop)、`#116`(今天改动走查)、`#133`(Gmail 真域名自测——connector 已完 + 部署侧手动验证)。

**轻耦合(能独立,但会被大块碰到,注意顺序)**:`#105`(MCP key 下载+README——碰块二 MCP 端点,建议块二后定稿)、`#132`(通用重试 HTTP infra + 禁 raw http——给块二插件铺路,先做不冲突)、`#109`/`#110`(chat summarize/booking 按钮——只调端点,externalize 在端点背后,可独立)、`#129`(summary revise——能力内逻辑,可独立)。

> 归位说明:`#101`(观察器=小 Zabbix)→ 块二 Phase D;`#102`(/admin/seo 真后端)→ **块一**(seo 是 misnomer = 公开 corpus landing/reader,见 1a/1c);`#118`(MCP vs HTTP admin parity)→ **块二 层②**(as-MCP-server,externalize 时校验)。这三个本是大块的一部分,曾被误列成杂活。

## 已 deferred

- **multi-vault ingestion** 🚧:把 vault 从 sync-unit 降为 named source(git-monorepo 当传输,namespace 子树,per-source snapshot diff)。明确**单 vault 先行**,以后再说。

---

## 我的推荐顺序(理由)

1. **块一先做,且从 1b 爬网检索起步**——边表已建、非 vector 已定、直接让检索质量跃升(dialogic retrieval over owner 的图 = 差异化本身),且**不依赖同步侧先补全**。
2. 然后 **1a**(folder-note + wiki/output 同步,把更多喂进图)。
3. 再 **1c**(callout / tikz / widget iframe / owner-CSS 同步)。
4. **块二**(平台替换 + driver)——结构性,想清楚再动,可与块一错开。

**每个 🚧/⬜ 要动手前先出 design + tests**(块一各片的落地设计:1b 的 BFS 深度/排序/ACL 进 query;1a 的 parent_id 从文件夹推;1c widget 的 postMessage schema + CSS sanitize 规则)。
