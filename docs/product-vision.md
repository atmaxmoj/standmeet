# 产品愿景

## 设计目标

把 StandMeet 从一个整体系统拆成**通过协议交互的独立组件**。每个组件可以独立替换、独立开源或闭源。

核心原则：**协议全部开源，实现灵活授权。**

---

## 工程哲学（从参考项目提炼）

核心参考：Elastic Stack（平台 + 上层 Solution）、Grafana Labs（插件架构 + big tent + 等到对的抽象再统一）、HashiCorp（每个产品 self-contained + 通过网络协议集成）。

### 1. 平台是万有引力中心，应用围绕平台生长

Elasticsearch 是 Elastic Stack 唯一不可缺的产品。Beats、Logstash、Kibana 都可选，但都往 Elasticsearch 里读写。Elasticsearch 独立可用（REST API 直接查），加上 Kibana 更好用，加上 Beats 更方便采集。

**对 StandMeet：蒸馏引擎（含记忆存储）是平台。所有应用都可选，但都往平台读写记忆。平台独立可用（CLI / API 查 Playbook），加上管理中心更好用，加上应用更有场景价值。**

### 2. 每个产品 self-contained，集成是附加价值

HashiCorp 的 Terraform、Vault、Consul 各自独立——自己的 CLI、自己的 API、自己的存储。你可以只用 Vault 不碰 Terraform。它们之间通过 HTTP API 集成，集成方式和第三方集成完全一样（Terraform 的 Vault Provider 走的是 Vault 的公开 API，没有后门）。

**对 StandMeet：数字分身展示没有蒸馏引擎也能跑（手动填内容）。蒸馏引擎没有任何应用也能跑（只观察学习）。两者同时存在时，通过 Memory Protocol 互通——数字分身展示读蒸馏出的 Playbook，对话记录作为 Episode 流回蒸馏引擎。但这是附加价值，不是前提。**

### 3. 自己的产品也走公开接口，不开后门

Grafana 做 Loki/Mimir/Tempo 时，通过和第三方完全一样的 data source plugin 接口接入 Grafana，没有特殊待遇。这保证了：(a) Grafana 对自家后端没有隐性依赖，(b) 第三方后端和自家后端平等竞争。

**对 StandMeet：数字分身展示读蒸馏引擎的记忆，和读自己本地存储的手动内容，走完全一样的接口（Memory Protocol）。不能给蒸馏引擎开后门。**

### 4. 共享的是约定（Schema），不是基础设施

Grafana 靠 label 体系让 metric/log/trace 可以关联。Elastic 靠 ECS（Elastic Common Schema）统一字段名。HashiCorp 靠 HCL 统一配置语法。它们共享的都是**数据格式约定**，不是共享数据库或共享代码。

**对 StandMeet：产品间的共享约定是 Memory Protocol 的 JSON Schema——Playbook、Episode、Identity、Meta 的格式定义。任何产品只要读写符合 schema 的数据就能互通。**

### 5. 采集层最开放，平台层可控

Elastic 的 Beats（采集）是 Apache 2.0，Elasticsearch（存储）是 AGPL。Grafana 的 Alloy（采集）是 Apache 2.0，Mimir/Loki/Tempo（存储）是 AGPL。逻辑：让数据尽量多地流进来（开放采集），在存储和分析层变现。

**对 StandMeet：采集适配器和协议规范最开放（AGPL / MIT），让社区贡献各种采集源。蒸馏引擎开源但 AGPL 保护。管理中心商业。**

### 6. 先让产品独立跑起来，再从实践中提炼协议

Grafana 有独立 agent 跑了好几年（Prometheus agent、Promtail），2024 年才出 Alloy 统一采集——等 OpenTelemetry 标准稳定了才动手。过早统一意味着选错抽象。

**对 StandMeet：protocols.md 定义的四个协议是方向，但不急着冻结。先让每个产品跑起来，从实际数据流中验证协议设计，再逐步稳定。**

### 7. 管理中心因复杂度而必须存在

多个 self-contained 产品 = 多个独立管理界面 = 用户管理负担。Docker Desktop 存在的原因是没人想开十个终端管容器。Kibana 存在的原因是没人想用 curl 查 Elasticsearch。

**对 StandMeet：蒸馏引擎是 headless daemon，各种应用各自独立。管理中心（Electron）把它们拉到一个界面里——管蒸馏引擎状态、管应用安装和配置、回答主动提问、审批执行建议。产品越多，管理中心越有价值。**

---

## 四层结构

蒸馏引擎不是产品，是**基础设施**。没人直接用数据库当产品，但所有产品都需要数据库。蒸馏引擎也一样——它产出 Playbook/Episodes/Identity/Meta，应用层通过协议各取所需。

```
┌─────────────────────────────────────────────────┐
│  应用层（各种产品，各自独立）                       │
│                                                   │
│  个人助手        日记生成器      数字分身展示       │
│  情绪陪伴        牛马监控(企业)   知识传承          │
│  ...无限可能                                      │
└──────────────────────┬──────────────────────────┘
                       │ Memory Protocol + Query Protocol
                       │
┌──────────────────────┴──────────────────────────┐
│  Electron 客户端（管理中心）                        │
│  管引擎 + 管应用 + 管权限 + 用户交互入口            │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│  蒸馏引擎                                         │
│  采集 → 过滤 → 蒸馏 → 记忆存储                    │
│  纯后台 daemon，headless                          │
└──────────────────────┬──────────────────────────┘
                       │ Observation Protocol (CloudEvents)
                       │
┌──────────────────────┴──────────────────────────┐
│  采集适配器                                        │
│  Screenpipe / IDE 插件 / 移动端 / 自定义           │
└─────────────────────────────────────────────────┘
```

---

## 产品定义

### 产品 1：蒸馏引擎（平台）

**独立价值**：观察用户行为 → 过滤信号 → 多层蒸馏 → 生成记忆（Playbook/Identity/Episodes/Meta）→ 执行层替用户操作。不需要任何应用也能跑。用户可以只用蒸馏引擎做个人复盘、看自己的 Playbook、让 agent 替自己处理日常操作。

**包含**：
- 采集层（Screenpipe adapter + 本地工具自动发现）
- 信号过滤层（转折点 / 回避 / 压力 / 任务边界）
- 多层蒸馏管线（秒级规则 → 任务级 Haiku → 小时级统计 → 天级 Sonnet → 周级 Opus）
- 记忆存储（Playbook / Identity / Episodes / Meta，SQLite + 向量索引）
- 执行层（情境检测 → Playbook 匹配 → agent 执行 → 反馈闭环）
- 主动学习回路（提问 → 用户回答 → 记忆更新）

**对外接口**：
- Observation Protocol（CloudEvents）— 采集适配器输入事件
- Memory Protocol（JSON Schema + REST 语义）— 应用层读写记忆的标准接口
- Query Protocol（REST + 向量搜索）— 应用层查询记忆

**技术栈**：Python daemon（详见 distillation-engineering.md）

**许可证**：AGPL v3

### 产品 2：管理中心（网关 + 统一管理面）

**为什么存在**：每个应用 self-contained 意味着每个应用都有自己的管理界面。蒸馏引擎也需要管理。如果用户装了蒸馏引擎 + 3 个应用，就要开 4 个不同的管理界面。管理中心把这些收到一个地方。

**本质是网关**：管理中心知道装了哪些产品（蒸馏引擎 + 各应用），知道怎么和每个产品通信，把各产品的管理面聚合到一个统一界面。

**包含**：

蒸馏引擎管理面（内置）：
- 蒸馏引擎状态监控（采集状态、蒸馏管线进度、记忆统计）
- Playbook 浏览和编辑（查看情境-行动对、maturity、评级）
- 主动提问界面（系统的问题推送给用户，用户回答写回记忆）
- 执行审批（建议模式下的操作确认）
- 执行规则配置（哪些操作允许全自动）
- 采集适配器管理（开关、权限）

应用管理面（聚合）：
- 应用安装 / 卸载
- 加载各应用的管理 UI（每个应用提供自己的管理页面，管理中心作为壳渲染）
- 统一的应用配置入口

**关键设计：用户面 vs 管理面**

每个应用有两个面：

```
用户面（独立）                    管理面（可聚合）
─────────────────────────────────────────────────
数字分身展示：                    数字分身展示：
  visitor 打开网页                  owner 管内容、邀请码、角色
  输入邀请码                        → 独立跑时：自己的 Electron
  和 AI 聊天                        → 接入管理中心时：嵌入管理中心
  这个永远独立

日记生成器：                      日记生成器：
  用户看日记                        配置日记格式、选择 Episode 来源
  这个永远独立                      → 独立跑时：自己的 Web UI
                                    → 接入管理中心时：嵌入管理中心

个人助手：                        个人助手：
  用户和助手对话                    配置执行权限、查看执行历史
  这个永远独立                      → 独立跑时：自己的 UI
                                    → 接入管理中心时：嵌入管理中心
```

**用户面永远属于应用自己，管理中心不碰。管理中心只聚合管理面。**

应用通过**应用注册协议**告诉管理中心："我是谁、我提供哪些管理页面、我的管理 API 在哪"。管理中心根据这个渲染导航和路由请求。

**和蒸馏引擎的关系**：管理中心通过 Memory Protocol + 蒸馏引擎的管理 API 通信。管理中心是蒸馏引擎的 client，不是蒸馏引擎的一部分。蒸馏引擎没有管理中心也能跑（CLI / API 管理）。

**技术栈**：Electron + React（复用现有 standmeet-client 的技术栈）

**许可证**：商业

### 产品 3+：应用层（各自独立）

每个应用是一个独立产品，self-contained，有自己的完整功能。接入蒸馏引擎后体验增强，但不依赖蒸馏引擎。

**第一个应用：数字分身展示**（现有 StandMeet 代码演化而来）

独立价值：Owner 手动填写内容 → Visitor 通过 AI 聊天了解 Owner。两种模式：Invitation Mode（WebSocket）和 BYOAI Mode（MCP OAuth）。不需要蒸馏引擎。

接入蒸馏引擎后的增强：
- AI 回答问题时不只靠手动填的内容，还能查 Playbook（"他遇到这种 bug 通常怎么排查"）
- AI 能用 Identity 推理未见场景（"他在技术选型时倾向约束强的方案"）
- 对话记录作为 Episode 流回蒸馏引擎（visitor 问了什么、AI 答不上来什么 → 蒸馏优先级信号）
- 手动填内容和蒸馏出的记忆格式兼容，通过 Memory Protocol 统一读取

包含：
- 内容管理（手动填写，现有 ContentEntry 系统）
- 角色和权限（Role + PathPermission）
- 邀请码系统（InviteCode + Invitation Mode）
- MCP server（BYOAI Mode）
- Gateway（Claude Agent SDK + WebSocket）
- Web 前端（Next.js visitor 界面）
- 管理端（Electron，管理内容 / 邀请码 / 角色）

技术栈：现有（Django + Node.js + Next.js + Electron）

**未来应用（各自独立产品）**：

| 应用 | 独立价值 | 接入蒸馏引擎后 |
|------|---------|--------------|
| 日记生成器 | 手动写日记 | 自动从 Episodes 生成每日总结 |
| 个人助手 | 通用 AI 助手 | 情境匹配 Playbook → 像你一样做 |
| 情绪陪伴 | 通用陪伴对话 | 检测到压力标记时主动关怀 |
| 知识传承 | 手动写知识文档 | 导出 Playbook 为结构化知识 |
| 技能差距分析 | 手动评估 | 从 Rating 自动分析哪些领域还是 observe |

---

## 产品间关系

```
用户面（各自独立，面向终端用户）          管理面（可聚合，面向 owner）
─────────────────────────────────   ─────────────────────────────────

visitor 浏览器                       ┌─────────────────────────────┐
  → 数字分身展示 Web                  │  管理中心（Electron 网关）     │
                                     │                              │
用户终端                              │  ┌── 蒸馏引擎管理面（内置）   │
  → 日记生成器 App                    │  │   Playbook 浏览/编辑       │
                                     │  │   主动提问/执行审批         │
用户终端                              │  │   采集适配器管理            │
  → 个人助手 App                      │  │                           │
                                     │  ├── 数字分身展示管理面（嵌入）│
                                     │  │   内容/邀请码/角色管理      │
                                     │  │                           │
                                     │  ├── 日记生成器管理面（嵌入）  │
                                     │  │   日记格式/来源配置         │
                                     │  │                           │
                                     │  └── 个人助手管理面（嵌入）   │
                                     │      执行权限/历史查看         │
                                     └──────────┬──────────────────┘
                                                │
                                     管理 API + Memory Protocol
                                                │
                                     ┌──────────┴──────────────────┐
                                     │  蒸馏引擎（平台）             │
                                     │  采集→过滤→蒸馏→记忆→执行     │
                                     └──────────┬──────────────────┘
                                                │
                                     Memory Protocol（JSON Schema）
                                                │
                                  ┌─────────────┼─────────────┐
                                  ▼             ▼             ▼
                           数字分身展示     日记生成器      个人助手
                           (后端+存储)     (后端+存储)    (后端+存储)
```

### 集成方式

**蒸馏引擎 ↔ 应用**：Memory Protocol（JSON Schema + REST 语义）。应用读记忆、写记忆，走标准接口。应用不需要知道蒸馏引擎内部怎么工作。

**管理中心 ↔ 蒸馏引擎**：管理 API（蒸馏引擎的状态、配置、控制）+ Memory Protocol（浏览/编辑 Playbook）。蒸馏引擎管理面内置在管理中心里。

**管理中心 ↔ 应用**：应用注册协议（应用声明"我是谁、我提供哪些管理页面、我的管理 API 在哪"）。管理中心加载应用的管理面，作为嵌入页面渲染。应用的用户面不经过管理中心。

**应用 ↔ 应用**：不直接通信。如果需要跨应用关联，通过蒸馏引擎的记忆中转——就像 Grafana 的 metric 和 log 通过 label 关联，不是 Mimir 和 Loki 直接通信。

### 共享约定

| 约定 | 作用 | 类比 |
|------|------|------|
| Memory Protocol JSON Schema | 记忆数据格式（Playbook/Episode/Identity/Meta） | Elastic Common Schema |
| Observation Protocol CloudEvents | 采集事件格式 | Beats 的 Lumberjack Protocol |
| 应用注册协议 | 应用向管理中心声明能力 | Kibana Plugin API |

---

## 我们自己的产品线

```
开源免费：
  ├── 蒸馏引擎（AGPL）
  ├── 采集适配器（AGPL）
  └── 协议规范（MIT）

商业产品：
  ├── Electron 管理中心
  ├── 第一方应用（部分免费部分付费）
  │   ├── 个人助手（免费，引流）
  │   ├── 数字分身（付费）
  │   ├── 日记生成器（免费）
  │   └── ...
  └── 组织层 SaaS（企业付费）
      ├── 组织蒸馏 + 组织 Playbook
      ├── 能力地图 + 任务调度
      ├── 牛马监控 dashboard
      └── 企业功能（离职保全、最佳实践 diff、招聘建议）
```

---

## 现有代码的归属

现有 StandMeet 代码整体归入**"数字分身展示"应用**：

| 现有组件 | 归属 | 备注 |
|---------|------|------|
| server/（Django + DRF + FastMCP） | 数字分身展示 | 内容管理 + API + MCP server |
| gateway/（Node.js + Claude Agent SDK） | 数字分身展示 | Invitation Mode 的 WebSocket 网关 |
| web/（Next.js） | 数字分身展示 | Visitor 前端 |
| standmeet-client/（Electron） | 数字分身展示 | Owner 管理端 |

蒸馏引擎和管理中心是全新的产品，从零开始。

### "记忆就是 content，content 就是记忆"

现有的 ContentEntry（路径 + JSON + 可见性）和蒸馏引擎的 Playbook（路径 + 结构化内容）本质上是同一种数据模型。当数字分身展示接入蒸馏引擎时：

- 手动填的 ContentEntry 和蒸馏出的 Playbook 通过相同的 Memory Protocol 读取
- AI 回答问题时统一查询，不区分来源
- 格式兼容靠 JSON Schema 约定，不靠共享数据库

---

## 开发顺序

遵循 Grafana Labs 的哲学："先让产品独立跑起来，再从实践中提炼协议。"

### Phase 1：稳固第一个产品

"数字分身展示"已经存在。确保它作为独立产品是完整的、稳定的。这是当前 repo 的工作。

### Phase 2：蒸馏引擎 MVP

新 repo。最小可用版本：采集（Screenpipe adapter）→ 信号过滤 → 单层蒸馏（周级 Opus）→ Playbook 输出。不需要完整的五层管线，不需要执行层。**先能蒸馏出 Playbook 就行。**

### Phase 3：第一次集成

数字分身展示接入蒸馏引擎的记忆。这时候 Memory Protocol 从纸上变成真的——从实际数据流中验证和调整 schema。

### Phase 4：管理中心

蒸馏引擎有了、应用有了，管理复杂度出现了，管理中心自然诞生。从现有 standmeet-client（Electron）的技术栈演化，但是新产品。

### Phase 5：更多应用

日记生成器、个人助手等。每个都是独立产品，各自 repo，各自 self-contained。

---

## 应用层范式：从使用中提炼，不预先设计

### 核心原则

参考 Claude Code 的演进路径（Boris Cherny / Anthropic）：

- **Latent demand**：只把用户已经在做的事变简单，不让用户做新的事
- **Never bet against the model**：scaffolding 是临时的，不要为今天的限制搭永久框架
- **The Bitter Lesson**：更通用的方案终将胜过更特定的方案
- **从重复中提取**：CLAUDE.md 来自用户自己写 markdown 喂给模型；Plan mode 来自用户在 prompt 里写"先别写代码"；Skills 来自用户想复用 prompt 模式。都是先有行为，再有产品化

### 应用层的推导

应用 = 独立产品，有自己的后端、存储、用户面。接入蒸馏引擎后体验增强但不依赖。

**现在不定义应用框架。** 等真实的重复模式出现再提取。具体：

**Phase 3（第一次集成）：直接调 REST API**

数字分身展示读蒸馏引擎的记忆，就是 HTTP GET/POST 到 Memory Protocol 端点。不需要 SDK、不需要 manifest、不需要注册协议。

```python
# 就这么简单
client = httpx.AsyncClient(base_url="http://localhost:5000")
r = await client.get("/memory/playbook/search", params={"q": query})
```

这一步的价值：验证 Memory Protocol 的 schema、查询模式、写回频率。从实际数据流中学习。

**Phase 4（管理中心）：最简方式发现应用**

```yaml
# ~/.standmeet/apps.yaml
engine:
  url: http://localhost:5000

apps:
  - name: digital-avatar
    manage_url: http://localhost:8000/manage
    health_url: http://localhost:8000/health
```

手动维护，不搞自动发现。就像 CLAUDE.md 是手写的。

**Phase 5+（第二个应用出现时）：从重复中提取**

第二个应用也要调 Memory Protocol、也要在 config 里注册、也要提供 manage_url。这时候再看什么值得抽象：

- 重复的 REST 调用 → 轻量 SDK
- 重复的配置格式 → 简单 manifest
- 重复的管理 UI 模式 → webview 加载约定

提取的时机是"第二次重复"，不是"第一次预测"。

### 参考实现（备忘，不急着用）

以下是调研过的成熟方案，留作 Phase 5+ 有 latent demand 时的参考：

**Shopify Apps**（最接近我们的架构——app 是独立服务）：
- App = 独立 web 服务，自己的后端和数据库
- 数据访问：REST/GraphQL + OAuth scoped token
- UI 嵌入：iframe + App Bridge SDK
- 能力声明：`shopify.app.toml`（scopes, webhooks, surfaces）

**Claude Code Skills**（最轻量的扩展范式）：
- Skill = 一个 SKILL.md 文件 + 目录
- 三级渐进加载：元数据(~100 tokens) → 完整指令(<5k tokens) → 附带资源(按需)
- 选择机制是纯 LLM 推理，没有路由系统
- Anthropic 立场："Don't build agents, build skills"

**VS Code Extensions**（声明式 UI 注册）：
- `contributes` 在 manifest 声明 commands/views/settings
- `activationEvents` 懒加载

**Home Assistant Integrations**（引导式安装）：
- Config Flow 多步设置向导

**Grafana App Plugin**（源码级分析，详见原 product-split.md）：
- 10 个机制：应用发现 Pipeline、前端路由代理、后端 API 代理、导航注册、应用设置存储、扩展点系统、平台 API、生命周期管理、权限模型、健康检查

这些都是"工具箱里的工具"。用哪个、什么时候用，等 latent demand 告诉我们。

---

## 开放问题

1. **Memory Protocol 的版本策略**：Phase 3 集成时从实际数据流中验证和调整 schema，不急着冻结 v1。

2. **现有 repo 的拆分时机**：蒸馏引擎是新 repo 这点比较确定。现有 monorepo 是否拆？

3. **管理中心的技术实现**：Phase 4 再决定。iframe/webview/React 微前端，等有真实场景再选。
