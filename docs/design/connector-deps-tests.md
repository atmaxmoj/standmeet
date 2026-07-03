# Connector 依赖解析重构 —— 测试设计（清单 + 状态/错误矩阵）

> **状态：** 计划（2026-06-24）。本次重构的**测试清单**：要补什么、现有的哪些改造、哪些
> 验收一起跑。范围限定在 connector 依赖解析这一刀，外加「一直等着跟 connector 一起改」的
> 归堆遗留（booked 卡外置 + cancel/email 从 REST 挪成 connector-backed tool）。**做完不留 legacy。**
> 排期（TDD 阶段）另说，这份只定**测什么**。

## Scope

**做什么（本刀）**

1. **host 依赖解析层** —— 命名 dep provider 注册表 + 读 `manifest.Requires` + 解析：
   - **gate 半边 → 并进 global 门**：`Requires` 任一 connector 未连 → 该 cap 不进
     `enabledCaps`（registry 单点闸，所有 visitor walk 唯一入口）→ 对所有 session 一律隐藏。
     删 booker 等 cap 里写死的 `Connected()` 自查。
   - **inject 半边**：已连时把 connector **句柄（非凭据）** 注入给运行的 binding/插件。
2. **归堆遗留** —— host 协议加 `mcp-ui:tool`；booker `Requires:[calendar,smtp]` 注入双句柄，
   book/cancel/send_confirmation 成 connector-backed tool；booked ui:// 卡经 `mcp-ui:tool` 调，
   退役 REST + 最后一张写死 React 卡（`NON_SANDBOX_CARDS` 清空）。

**不在本 scope：** sync 模式（Obsidian→corpus，#107/#108 自成一摊）；跟 connector 无关的 surface。

## 锁定的决策点

- **D-1：未连 = 全隐藏（经 global），非降级可见。** 维持现状；置灰按钮 UX 归 #110。
- **D-2：connector gating 收进 `enabledCaps`（global 单点闸）**，不另起 per-session gate。
  `global(cap) = owner手关 ∧ 所有 Requires 已连`。
- **D-3：booked 外置 + cancel/email→tool 进本刀**，做干净。
- **D-4：发确认信的收件人硬控（引用/透传/422/skip）放 tool 内（后端校验，422 仍后端出）。**
  卡只收集 + 显示 —— #121 收件人硬控由 `send_confirmation` tool 后端把守，沙盒卡绕不过。
- **D-8：connector = 消费者无关、双向的底座。** 凭据/OAuth/重试全在连接器内，**谁用它不感知**。
  MCP 能力（经 capreg 依赖解析 gate）只是「其中一个消费者」；将来的 **IM Gateway**（owner 在
  Discord/Slack 被 @ → Gateway 唤起 agent → agent 用连接器凭据**读 channel 历史** + **发消息**）
  是另一个消费者，**不碰 MCP**。因此「按名解析连接器 + 拿句柄」必须住中性位置、**不 import
  capreg**；句柄双向（read+write）、无凭据 getter。守卫测试：`connector.TestConnector_
  ConsumerAgnostic_BidirectionalGateway`（fakeGateway 不 import capreg = 编译期证明）。
  实现阶段把 `capreg.DepRegistry` 并进中性的 `connector.Hub`（一个底座、多个消费者）。

## 测试哲学（沿用平台架构测试设计）

- 插件 / connector 是真·外部依赖 → **mock 在传输边界，不 stub**。合成 connector 接真注册表；
  测试 MCP 插件用真 server（`mock-stack/mcp`）。
- **对 feature floor 逐条核**：global/role/code ACL、**connector 依赖**、quota、mode、
  capability_state、降级可见。
- **error stream**：链路任意一步崩仍可控、友好降级，无 stack/挂死/泄密。
- **替身**：`dep-provider:test`（合成 connector「X」，`Connected` 可切 + 代调方法 + 泄漏探针，
  仅测试装配，绝不进 prod 注册表）；`mock-stack/mcp` 加一个 `Requires:["dep-provider:test"]` 的工具；
  mock GCal / SMTP / OAuth 沿用 external-mock。

---

## 一、要补的测试（新增，现在没有）

**后端 unit / integration**
- dep-provider 注册表：register / lookup / 重名拒
- `Requires` boot 校验：未知依赖名 → 拒 + log（现 `manifest_test` 只测 parse）
- `enabledCaps` 并入 connector 状态：`Requires` 有未连 → 不进 enabledCaps
- 句柄契约：已连返句柄、**无凭据 getter**（编译期保证密不进 caller）
- 多依赖 AND（A 连 B 未连仍隐藏）；global 手关优先于「已连」
- `provider.Connected()` 返 error（非 true/false）时的处置（见错误矩阵 E1）

**e2e**
- **任意性（命门）**：合成 X + `mock-stack/mcp` `Requires:[X]` → 未连掉走 / 已连调通 / 密不泄漏 / mid-session 撤→降级
- **ext-mcp 默认不接 dep**（声明 `Requires:[calendar]` 也不注入，需 owner 显式授权）
- **单点闸三 walk 一致**（AssembleVisitor / VisitorStates / VisitorToolSpecs 同进同出）
- **`mcp-ui:tool` 协议**：卡发具名工具 → host 带 session context 派发 → 回卡（unit + 卡集成）
- **visitor `calendar_cancel` 作 tool**（今天只有 REST）+ **`send_confirmation` 作 tool**（今天 REST）
- **密不泄漏到 booker 插件**（句柄注入后的新泄漏面）
- 状态变更 + error-stream 全部缺口（见下两矩阵，标「补」的每格 = 一条用例）

## 二、要改造的测试（现有，因机制/结构变）

- `visitor-cancel-booking` —— 取消从「React 卡 + REST」→ iframe 卡 + `mcp-ui:tool→calendar_cancel`；
  testid + 机制全变（**隔离负例语义保留**：Mallory 取消不了 Dana 的）
- `booking-confirmation-email` —— 发信从「`booking-email-*` + REST」→ iframe 卡 +
  `mcp-ui:tool→send_confirmation`；引用/透传/422/skip 四条卡内重表达（收件人校验按 D-4）
- `visitor-chat-book-card` —— React booked 卡 → `mcp-app-card-calendar_book` iframe（frameLocator）
- `manifest_test.go` —— 加 `Requires` 拒绝用例
- `connector-secret-no-leak` —— extend：也断言密不进 booker 插件
- capreg / ACL hierarchy 单测 —— enabledCaps 现在算 connector 状态，加用例

## 三、状态变更矩阵（connector 生命周期 × 时机）—— 重点不漏

生命周期：`未配 → 配凭据未授权(no refresh_token) → 已连 → 断联(token 清、凭据留) → 重连 → 外部撤销(invalid_grant)`。
时机：① 装配时 ② 两 turn 间（状态在 turn 之间变）③ 同 turn 内 mid-call ④ mid-stream(SSE 中)。

| 状态 / 转变 | 时机 | 期望 | 覆盖 |
|---|---|---|---|
| 未配 | 装配 | 隐藏 | ✓ `chat-book-not-connected`(隐含) |
| **配了凭据、未授权(no refresh_token)** | 装配 | `Connected=false` → 隐藏 | **补**(half-config 边界) |
| 已连 | 装配 | 暴露 + 注入句柄 | ✓ `chat-book-success` |
| 已连 | mid-call | 调通 | ✓ |
| **已连→断联(owner disconnect)** | 两 turn 间 | 下一 turn 该 tool 隐藏（单点闸重算） | **补**(mid-session disconnect) |
| **已连→断联** | mid-call(已发 tool 列表、调时已断) | 友好降级，无 500/stack | **补**(依赖 mid-turn 断) |
| **断联→重连** | 两 turn 间 | 下一 turn tool 重现 | **补** |
| **断联(token 清、凭据留)** | 装配 | 隐藏（`refresh_token IS NULL`） | 部分 ✓ `admin-gcal-disconnect`(fresh session) |
| token 过期可刷新 | mid-call | 静默刷新成功 | ✓ `chat-book-token-refresh` |
| **token 撤销(invalid_grant)** | mid-call | 刷新撞 invalid_grant → 友好降级 | ✓ `connector-revoked-degrades` |
| **撤销后状态落库** | 撤销后下一装配 | 置 disconnected → 隐藏（撤销→gate 联动） | **补** |
| mail 断联 | 两 turn 间 | 依赖 smtp 的能力隐藏 | 部分 ✓ `mail-connector`(fresh) → **补** mid-session |
| **多 session 并发** | owner 断联 | 两 session 下一 turn 都失 tool | **补** |
| **改身份字段：mail 换 SMTP 邮箱/host/密码** | edit-config | `verified=false` → 依赖 smtp 的能力隐藏 → 重走 OTP 才恢复 | **补** |
| **改身份字段：calendar 换 client_id/secret** | edit-config | 清 token(`refresh_token=NULL`) → 隐藏 → 重 OAuth 才恢复 | **补** |
| **改非身份字段（policy / calendar_id / 显示名）** | edit-config | **不** disconnect，连接/验证状态不动 | **补**（守住「只有身份变才重验」） |

> 现状基本只测了「装配时状态」和「mid-call 刷新失败」两点；**turn 间状态翻转、mid-turn 断、
> 撤销→gate 联动、半配、并发、改配置→重验**都缺。
>
> **决策点 D-5：改 connector「身份」字段（凭据/邮箱/host）→ 重置 verified/token、强制重验、
> 期间隐藏；改「非身份」字段（policy/calendar_id/显示名）不动连接。**

## 四、错误流矩阵（全链路每一步失败）—— 不留遗漏

链路：`装配解析 → provider.Connected? → 注入句柄 → 插件 tool call → connector proxy → 解密 → 外部(Google/SMTP) → 回`。

| # | 步 | 失败模式 | 期望 | 覆盖 |
|---|---|---|---|---|
| E1 | `provider.Connected()` | DB 读错 | 当未连隐藏 + log，不崩 | **补** |
| E2 | 解析 | 运行时未知依赖名（防御，boot 后理论不该有） | 隐藏 + log | **补** |
| E3 | 注入 | 句柄构建失败 | 能力隐藏 / 友好 | **补** |
| E4 | proxy | 插件→host unix socket 不可达 | 友好降级 | 部分（plugin-down 泛测）→ **补** connector-specific |
| E5 | 解密 | vault 损坏 / 密钥不符 | 友好，**错误里无密** | **补** |
| E6 | Google | `freeBusy`/`events.insert` 返 500 / 403 / 429 / timeout / 网络断 | 友好降级，无 stack，无 raw provider err | **补**（现只有 conflict 正常响应 + 刷新失败） |
| E7 | token refresh | network / 500（非 invalid_grant） | 友好降级 | **补** |
| E8 | SMTP | 连接拒 / 认证失败 / 超时 / 5xx 收件人拒 | 友好，卡内错误 | **补**（现只有 422 pre-send） |
| E9 | 收件人 | 非法地址（pre-send 422） | 拒，不发 | ✓ `booking-confirmation-email` |
| E10 | 多步 partial | book 成、**owner-notify 邮件失败** | **不**回滚 booking，记录/吞 | **补**（核 `booking-owner-notify` 是否覆盖失败分支） |
| E11 | 多步 partial | book 成、**确认信发失败** | booking 保留，卡显错 | **补** |
| E12 | `mcp-ui:tool` | host 派发失败 / session 失效 / quota mid-action 耗尽 | 卡内友好，不挂死 | **补**（R4 新路径） |
| E13 | 幂等 | 重复 cancel / 取消已取消 | 幂等；404 当 cancelled | 部分 ✓ `visitor-cancel-booking`(404) |
| E14 | 幂等 | 确认信重复发 | 防重 / 明确语义 | **补** |
| E15 | mid-stream | SSE 中断 during connector-backed tool call | 可恢复，不脏 transcript | **补** |

## 五、重试矩阵（第三方易抖 → 按 call-class 配重试，复用 #132 通用可配重试 infra）

**底座原则：** 重试策略 = 架在 **#132 通用可配重试 infra** 之上的 **per-op 代码配置**。
通用底座（退避/封顶/retryable 判定/context 打断）**不动** —— connector 操作只「配」不「改」它。

**设计点（已锁）：**
- **D-6（锁定）：sync vs async 不是全局开关 —— 每个 connector 操作在 connector 侧按自身业务语义
  声明自己的重试模式 + 预算（代码级 per-op）。** 确认信 / owner-notify 各挑各的；测试只验
  「每个 op 按它声明的策略行事」，不替它们选一个全局模式。
- **D-7（锁定）：sync 默认小预算 = 3 次，退避 1s/2s/4s，之后友好降级。硬封顶，绝不无上限：**
  ① 次数封顶 ② **退避有 max interval 上限**（不指数无限涨）③ **总时长封顶**（context deadline，
  例 ~10s）→ 到点立即停 + 降级，即使退避没走完。async（10×）同理：次数 + 总时长双封顶。
  （3/1-2-4/~10s 是 sync 默认值，op 可在同一封顶 infra 内覆盖。）
- **写幂等**：`events.insert`/`smtp send` 盲重试会双订/双发 → 只在「发送前连接失败」重，或带幂等键。

| call | 同步? | 幂等? | 重试策略 | 测试 |
|---|---|---|---|---|
| `freeBusy` / `list_slots`（读） | sync | 是 | 短预算快速退避 | 瞬时错→重→成功；耗尽→降级 |
| `events.insert`（订，写） | sync | **否** | 仅发送前连接失败重 / 幂等键 | **重试下不双订** |
| `cancel`（delete） | sync | 是（幂等） | 短预算 | 重→成功；重复 cancel 幂等 |
| token refresh | sync（嵌在调用里） | 是 | 短预算快速退避；invalid_grant 不重(直接降级) | network/500→重；invalid_grant→不重→降级 |
| 确认信 `send_confirmation` | op 声明 | **否** | op 自定（异步→10×长 / 同步→短预算） | **重试下不双发**；耗尽→卡显错 |
| owner-notify 邮件 | async（不堵 booking） | **否** | 10×~30–60s 后台 | book 成即返；通知失败重试，**不回滚 booking** |
| sync ingest（Obsidian） | async | 视情况 | 10×长（**本刀外**，#107/#108） | — |

通用重试 infra（#132）本身的单测：退避计算、maxAttempts 封顶、retryable 判定（哪些错该重）、
context 取消/超时打断重试、jitter。

## 六、回归网（验收一起跑，原样不动 = 行为等价证明）

`chat-book-not-connected` · `chat-book-success` · `chat-book-conflict-{busy,policy-hours,policy-leadtime,policy-weekend}` ·
`chat-book-{public,byoai}-denied` · `chat-book-skill-not-granted` · `chat-book-quota-exhausted` ·
`chat-book-schema-rejects-partial` · `chat-book-session-email-default` · `chat-book-token-refresh` ·
`booking-owner-notify` · `connector-{revoked-degrades,add-modal}` · `admin-connectors-extended` ·
`mail-{connector,connector-state,otp}` · `admin-gcal-{oauth-connect,disconnect,policy-edit}` ·
`tool-calendar-cancel-booking`（owner-side facade，无关） · `tool-endpoint-calendar-book` · `tool-calendar-list-slots` ·
`visitor-chat-list-slots`（F 已迁） · `mcp-skill-grant-booking` ·
session-capability-bundle · capability-acl-hierarchy 全套

> 注：状态/错误矩阵里标 ✓ 的若机制变了（gating 走 global、cancel/email 走 tool），归「改造」桶重表达，
> 不留在回归网；标「部分 ✓」的要补足缺口分支。
