# StandMeet Roadmap —— 大块级

> **视角:** 这份文档只写**大块(major blocks)**——"要建的下一件大事"。颗粒度小的具体项在 task tracker 里,不重复。
> **来源:** 综合 `~/Develop/writing/notes/wiki/software/project/standmeet/`(owner 的设计 vault)+ 现有代码实况。vault 里很多 seed **本身没落地设计**(有的打了 🚧,有的没打),所以每个大块要动手前,都得像 connector 那样**先出一版 design + tests**,再写。
> **状态图例:** ✅ 建好 · 🟡 部分建 · ⬜ 没建 · 🚧 = vault 里标"设计在飞、未落地"。

---

## 块一 · corpus = Obsidian vault(产品核心承诺,最大且最散)

一句话:**owner 在 Obsidian 写 → StandMeet 同步 → StandMeet 是这套 portable markdown 的另一个 renderer,把 curated 的图服务给访客。** 这直接兑现 product hub 的"author in Obsidian, sync to StandMeet"、thesis(AI 对话→curated corpus)、differentiation("a personal site, but conversational" + owner 亲手织的图 = relevance signal)。

corpus 数据形态**已经就是 vault**:三级 promotion(raw→wiki→output)、derived-path(parent_id 树,reparent 免费,无 path 列)、backlinks 声明式重建边表(`wiki_refs`/`writing_refs`)。所以大块一不是"重建 corpus",是"**把 vault 的三个面(喂图/爬图/渲染)补齐**"。

### 1a · 同步侧(喂图) 🟡(建了最简版,大半没测透)
- 🟡 `writings` 一层有 export(zip)/ import(整 vault) 手动批量(~1200 行:`usecases/obsidian/{import,export,frontmatter,attachments,import_parse}` + `routes/admin/obsidian.go`)。**但只是最简实现,测试薄**:6 个 e2e 只覆盖了 publish 闸跳过 / attachment roundtrip / 重复 import 全 skip / UI 按钮。**没测的关键不变量**:web-edits-win(web 改后 import 别覆盖)、frontmatter 字段映射(excerpt/cover_*/visibility/tags)、body `[[链接]]`→`writing_refs` 抽取、update-path(同 `obsidian_source_path` → 更新而非新建)、错误分支(坏 frontmatter/缺附件/坏路径)。→ **扩 wiki/output 前,先把现有 writings sync 测硬**。
- ⬜ **wiki / output 没接同步**(`domain/obsidian.go` 接口本就 genre-generic,能挂上但没挂)。
- ⬜ **folder-note 折叠没实现**:现在裸 `basename(path)` 当 slug,遇到 `foo/foo.md` 会造重复 `foo/foo`。规则:`basename(file)==basename(dir)` → 该文件是 folder note,其 node path = 目录路径。这是 wiki/output 同步 + 层级的**前置**。
- ⬜ **open question(vault 里没答)**:wiki 同步时 `parent_id` 具体怎么从 vault 文件夹树推。
- 相关具体项:`#151`(raw 分级/层级)、`#113`(`seo_indexed`→`published`,跟 vault `publish` 闸对齐)、`#114`(landing/reader 拆出)。

### 1b · 检索侧(爬这张图) 🚧 ⬜
- ✅ `corpus_search`/`_read`/`_list` over Postgres 全文检索;导航**只爬树**(parent_id)。
- ⬜ **爬网(graph retrieval)**:搜到 hit → 顺 `wiki_refs` 出边(cites / read-next)+ 入边(backlinks)做 bounded-depth BFS,Obsidian-style search。**边已经在数据里**,纯"检索时跟着走"。
- **决策已定**:**故意不用 vector/pgvector**——相关性 = owner 写的 `[[链接]]`,不是模型猜的语义距离。
- 落地设计要补:BFS 深度/排序上限、ACL 怎么进 query(别爬到 role 不可见的 entry)、跟全文检索怎么合。
- 相关:`#150`(output backlinks——output/writings 得跟 wiki 一样有边表,图才连得起来)。

### 1c · 渲染对称(两侧同源) 🟡
- ✅ KaTeX + Mermaid(D-6)。
- ⬜ **Callout `> [!theorem]`**:markdown pipeline(`app/src/components/page/markdown.tsx`)加 remark/rehype transform,DOM 对齐 Obsidian(`class="callout" data-callout="…"`)。
- ⬜ **TikZ 精确数学图**:Mermaid 只画拓扑;候选 TikZJax(Obsidian 同引擎 → 两侧一致)。WASM payload 大,须 lazy。
- ⬜ **`standmeet-widget` 沙箱 iframe 块**:动态内容走 fenced block → sandboxed iframe + **host 定义的 postMessage 边界(manifest + `render(data)`/`resize`/`requestCapability` schema)** + ACL + `seo:false`。**这是 MCP Apps `ui://` 的渲染版**(同一个 iframe+postMessage 模型,可复用)。
- ⬜ **同步 owner 的 Obsidian CSS snippet**(2026-07 owner 决策,**改了原"never import CSS"设计**):把 `.obsidian/snippets/<enabled>.css` 同步进来当 StandMeet 页面 CSS,做到"两侧长得一模一样",不再手写对齐 CSS。**站得住是因为这份 CSS 是 owner 自己的、可信的**(非第三方)。三点:(a) vault-ingestion 的"点前缀全忽略"要给这一个文件开白名单例外;(b) **sanitize**——禁 `@import`/外部 `url()`(防外泄/打请求)、scope 到内容容器(防 `position:fixed` 盖 UI);(c) 归位到 1c。

### 1d · Obsidian 生态借力(不 host 插件,借它的 output/code/信号) ⬜
**不能在 StandMeet 里跑 Obsidian 插件**(闭源 Electron host = 那道墙;连 Obsidian 自己的 Publish 都跑不了插件)。但生态的价值三条路进来:
- **authoring helpers**(Templater/QuickAdd)→ 无需——它们只在写作时跑,留下的是 plain markdown,直接 ingest。
- **rendering**(KaTeX/Mermaid/TikZ)→ **别用插件,直接用底层库**(见 1c)。
- **Dataview 类(query)→ 原生做,而且更强**:corpus 本就是真 DB(Postgres)+ frontmatter + `wiki_refs`,可以跑 Dataview 式查询,比 Dataview-over-files 强。⬜ 值得建"corpus 查询"。
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
| **D · 解散** | ACL 已成(session 建立时发现过滤);**观察器 = 设备/系统可观测面(小 Zabbix:health/CPU/内存/磁盘/服务/uptime)→ admin/system `#101`,把现在的假硬编码换成真的**;**secret-scan 并进 connector(B)** | 🟡 **唯一 pending `#142`**——ACL/secret-scan 已归位,实际只剩 `#101` 真观测面 |
| **E** | as-MCP-server facade(聚合插件 owner 工具成单端点) | ✅ `#143` |
| **F** | MCP Apps UI(`ui://` 卡片在 chat 渲染) | ✅ `#134` |
| **(G)** | (task 里无 G,跳过/未编号) | — |
| **H** | 管理面(origin + enable/disable + admin 能力面板) | ✅ `#145` |

→ **层①实际只欠 Phase D**,而 D 主要是把观察器归到 `#101`、secret-scan 并进 B——收尾性,不是大工程。

### 层② · "替换"迁移 —— **决策点 P.2 明写"迁移留到后期,先并存"**,这才是块二的大头 ⬜
机制(层①)搭好了,但**真正的外置迁移没做**:me/seo/codes + jobs/resume/applications 仍 `MustRegister` 进核心 capreg。要做的是把每个能力**迁出成独立标准 MCP server**、`ListByOrigin(builtin)` 数到零、删 `MustRegister` + 进程内 registry。feature floor(P.1c:横切 gating/state 全留 core)不得削减,每条有 spec 看守。**结构性大、牵一发动全身。**

### 层③ · agent-as-injectable-driver —— Bridge 抽象 ✅,runtime 形态 🚧
- ✅ **Driver/Bridge 接口已抽**(`#153` agentcore 抽 Driver、`#154` eval 做成忠实 mini-host)——决策点 P.13 的结构实现落地了。
- 🚧 **还差**:把"inject-and-launch"从 test-only 提成**一等 runtime 形态** → 并行跑很多 prompt、实验出好 prompt("eval 是类型系统";prompt 被验证而非设计)。这也是 eight-controls 里缺的**"质量半"**(selection/shaping)。

---

## ~~块三 · prod 单机可部署~~ —— **砍掉**(2026-07 owner 决策)

- server + 域名 + 证书那套是 **owner 在域名/服务器供应商那边自己绑**(不是我们出 Caddy/LE 自动签证书——CLAUDE.md 里"one command + 自动 LE"愿景**作废**)。
- 我们只需**知道自己的域名**,而填写机制**已有**(owner profile `public_url` + `allowed-domains`,`routes/admin/public_url.go`+`domains.go`)。→ 等于已完成,不再是大块。

---

## 非大块(杂活清理,一轮 pass 搞定)

admin 接真后端 + 基建杂活,智力上不是大块:`#102`(/admin/seo 真后端)、`#103`(role 卡编辑 prompt)、`#104`(per-code prompt)、`#105`(MCP key 下载凭证+README)、`#106`(inference 计费)、`#117`(URL env prod fallback)、`#118`(MCP vs HTTP admin parity)、`#132`(通用重试 HTTP infra)、`#152`(mock 正名)。

> 注:`#101`(/admin/system 真观测面)**不在此**——它是块二 Phase D 的**观察器**(小 Zabbix:去掉假 health,上真设备/系统指标)。

## 已 deferred

- **multi-vault ingestion** 🚧:把 vault 从 sync-unit 降为 named source(git-monorepo 当传输,namespace 子树,per-source snapshot diff)。明确**单 vault 先行**,以后再说。

---

## 我的推荐顺序(理由)

1. **块一先做,且从 1b 爬网检索起步**——边表已建、非 vector 已定、直接让检索质量跃升(dialogic retrieval over owner 的图 = 差异化本身),且**不依赖同步侧先补全**。
2. 然后 **1a**(folder-note + wiki/output 同步,把更多喂进图)。
3. 再 **1c**(callout / tikz / widget iframe / owner-CSS 同步)。
4. **块二**(平台替换 + driver)——结构性,想清楚再动,可与块一错开。

**每个 🚧/⬜ 要动手前先出 design + tests**(块一各片的落地设计:1b 的 BFS 深度/排序/ACL 进 query;1a 的 parent_id 从文件夹推;1c widget 的 postMessage schema + CSS sanitize 规则)。
