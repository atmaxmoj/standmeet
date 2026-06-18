# StandMeet 平台架构 —— 测试设计

> **状态：** 草稿，待评审（2026-06-18）。配套 [`platform-architecture.md`](platform-architecture.md) 读。
> **读者：** 写 mock 插件 server / fixture / spec 的人。
> **怎么反馈：** 每块结尾 `T.n` 决策点，回 `Tn: accept` / `Tn: change — <…>`。

---

## TL;DR — 测试哲学

0. **每个 phase 第一步就是写测试，且必须全面（铁律）。** 任何 phase 动实现之前，先把**完整测试套件**写出来并红着：
   - **happy flow** —— 正常路径成立。
   - **corner cases** —— 全覆盖：空/缺字段、边界值、并发、重复、未授权、未连接、配额耗尽、版本不符、撞名、降级可见、幂等。
   - **error stream（中途出错）** —— 流式/多步链路里**任意一步崩**仍可控：tool 调用中途失败、连接器代调失败、插件进程 mid-session 退出、SSE 流中断、依赖 mid-turn 断、超时。每条都要有用例，且 UI/agent 表现是**友好降级**，不是 stack trace / 挂死。
   覆盖不到位 = phase 不算开始。先红后绿（CLAUDE.md：未测 = 未完成）。
   - **对着 feature floor 逐条核**，别只对着"这东西干啥"审。每个 visitor-facing 能力都要按 floor 清单走一遍：**ACL via role、connector 依赖、quota、mode(code/public/byoai)、capability_state、降级可见** —— 适用的每条都要有用例。（教训：C3 漏了 ACL，因为只对着"插件 dial/list/wrap"审、没对 floor 核 → 漏测 → 漏实现。floor 就是 checklist。）

1. **e2e 是 feature 的唯一证明（CLAUDE.md）。** 「core 发现了它没写死的能力」这件事，必须有一条**浏览器驱动**的 e2e：真访客进 chat → AI 调到一个**配置声明、非 `MustRegister`**的工具 → 答案正确。这是 C4，是本 feature 的主证。
2. **协议管道层补 unit/integration，但不当主覆盖。** manifest 解析、stdio 帧读写、version 闸 —— 这些是组合爆炸的纯管道（畸形 JSON / 版本不符 / 进程退出），用浏览器跑既慢又测不全。它们是 booking_confirmation_test.go 那种**补充快测**，不替代 e2e。先例已在：`inference` / `mailer` / `booking_confirmation` 都有 unit。
3. **插件是真·外部依赖 → 不 mock 在 mcpclient 层，mock 在传输边界。** 跟 job-board-mock 同理：**mcpclient 代码用真**，只让它连/拉起一个我们写的**真 MCP server**（说真 JSON-RPC、真 stdio/http），只有它的*内容*是 fixture（一个 echo/marker 工具）。绝不 stub `Session`。
4. **零 if、零 sleep（项目规则）。** unit 用 testify `require.*`；e2e 等 UI 状态，不 `setTimeout`-as-sleep。
5. **测试按行为命名**，不按 commit：`plugin-discovery-chat.spec.ts`，不是 `c4.spec.ts`。

**决策点 T.0：每个 phase 先写全面测试（happy + corner cases + error stream），红了再实现。覆盖不全 = phase 不算开始。**
**决策点 T.1：上述哲学接受。**

---

## 测试替身 —— `mock-mcp-plugin`（一个真 MCP server）

新增 `backend/cmd/mock-mcp-plugin`（跟 backend 同 binary 复用，**不**用 node）。它说**真 MCP**：`initialize` + `tools/list`（返一个 `echo` 工具：吃 `{text}` 回 `{"echoed": "<MARKER>:<text>"}`）+ `tools/call`。

**双模式，同一份逻辑：**
- `--stdio` → 走 stdin/stdout（newline 分隔），给 C2/C4 的 stdio 路径用 —— core 把它当子进程拉起来。
- `--http :PORT` → Streamable HTTP 单端点，给 C3/C4 的 http 路径 + ext-mcp 回归用。

**故障注入开关（环境变量 / flag，给「中间出错」用例）：**
- `MOCK_PLUGIN_PROTOCOL_VERSION=<v>` —— 让它 initialize 返一个**不兼容版本** → 测 version 闸。
- `MOCK_PLUGIN_FAIL=call` —— `tools/call` 返 MCP error → 测调用期出错折成 errJSON。
- `MOCK_PLUGIN_FAIL=list` —— `tools/list` 报错 → 测发现期失败 silently skip。
- `MOCK_PLUGIN_EXIT_AFTER=1` —— 跑一次 call 后进程退出 → 测 session 中途死。
- `MOCK_PLUGIN_TOOL_NAME=<name>` —— 改它暴露的工具名 → 测**影子**（声明一个跟内建撞名的工具/能力 id）。

**决策点 T.2：一个 `mock-mcp-plugin` 二进制，双模式 stdio+http，fixture = 一个 echo/marker 工具，故障靠 env 开关。**

---

## C1 —— manifest + 发现来源 + 版本闸（unit, testify, 零 if）

文件：`backend/internal/plugins/manifest_test.go`（external test package）。

| 测试 | 断言 |
|---|---|
| `ParseConfig_StdioAndHttp` | 一份含 1 stdio + 1 http 的配置 → 2 manifest，各字段（id/version/shape/transport.Kind/command/url）精确 |
| `ParseConfig_MalformedJSON` | 畸形 JSON → 返 error（require.Error） |
| `ParseConfig_UnknownTransportKind` | `kind:"carrier-pigeon"` → 该条被拒（require.Error 或不进 list，二选一定死） |
| `ParseConfig_MissingRequiredID` | 缺 id → 被拒 |
| `ParseConfig_DuplicateID` | 同配置内重复 id → 被拒 |
| `Source_VersionIncompatible_Skipped` | 一条不兼容 version → **不在**返回 list，且**有** log（不是静默丢） |
| `Source_Empty_NoError` | 配置缺失 / 空 → 空 slice + nil error（部署默认无插件，合法） |
| `Source_MixedValidInvalid` | 一好一坏 → 好的进 list，坏的被滤，list 长度=1 |

纯数据层，不接 Registry、不起 server。

**决策点 T.3：C1 全 unit，覆盖 manifest 解析 + version 闸的组合边界。**

---

## C2 —— mcpclient transport 抽象 + stdio（integration，真 mock server）

文件：`backend/internal/mcpclient/stdio_test.go`。对真 `mock-mcp-plugin --stdio` 跑。

| 测试 | 断言 |
|---|---|
| `Stdio_Initialize_ListTools` | 拉起子进程 → initialize 成功 → ListTools 含 `echo`，inputSchema 正确 |
| `Stdio_CallTool_Echo` | CallTool(`echo`,`{text:"hi"}`) → result 含 `MARKER:hi` |
| `Stdio_StderrIgnored` | server 往 stderr 写日志 → 不破坏 stdout 帧解析，CallTool 仍 OK |
| `Stdio_ProcessExitMidSession` | `MOCK_PLUGIN_EXIT_AFTER=1` → 第二次 CallTool 返**干净 error**（不 hang、不 panic） |
| `Stdio_Close_ReapsProcess` | Session.Close → 子进程被回收（无僵尸；可查 wait 返回） |
| `Transport_ParitySmoke` | 同一 Session API 跑 stdio，断言跟 http 同形（ListTools/CallTool 返回结构一致） |

HTTP 路径回归：跑现有 ext-mcp e2e（已覆盖 http），确认抽 Transport 没碰坏。

**决策点 T.4：C2 用真子进程，覆盖 stdio 的 stderr / 中途退出 / 进程回收三个易漏点。**

---

## C3 —— `pluginCapability` 适配器（integration）

文件：`backend/internal/usecases/plugin_capability_test.go`。

| 测试 | 断言 |
|---|---|
| `PluginCap_Binding_HasTool` | manifest（指向 mock http 插件）→ VisitorBinding → Binding.Tools 含命名空间化的 echo 工具 |
| `PluginCap_UIMeta_IntoExtra` | manifest 带 `ui{resourceUri}` → CapabilityState.Extra 携带 ui.resourceUri（#134 接点） |
| `PluginCap_DialFail_Hidden` | bad command/url → 返 `ErrHidden`（silently skip，不阻塞 chat） |
| `PluginCap_ListFail_Hidden` | `MOCK_PLUGIN_FAIL=list` → ErrHidden |
| `PluginCap_CallError_FoldedToToolResult` | `MOCK_PLUGIN_FAIL=call` → CallTool 折成 errJSON tool_result，**Go err = nil**（ext-mcp 唯一不变量） |
| `PluginCap_Origin_Managed` | 经 RegisterDiscoveredPlugins 注册 → ListByOrigin(managed) 含它；ListByOrigin(builtin) 不含 |
| `PluginCap_ShadowBuiltin_BuiltinWins` | 插件 id 撞内建 → 注册被拒 + log，内建仍在，List 里该 id 仍是 builtin |
| `ExtMCP_Regression` | ext-mcp 现有测试全绿（证明泛化没回归） |

**决策点 T.5：C3 覆盖 dial/list/call 三处「中间出错」+ origin 区分 + 防影子。**

---

## C4 —— boot 发现 + e2e（浏览器驱动，主证）

文件：`e2e/test/plugin-discovery-chat.spec.ts`。docker-compose 起 `mock-mcp-plugin`（http 模式一个 service；stdio 模式由 backend spawn），配置文件声明它。

| 测试 | 断言 |
|---|---|
| `配置声明的插件工具，访客 chat 里被 AI 调到` | 真访客进 chat → 脚本让 mock LLM 调那个插件工具 → 答案含 `MARKER` → **core 发现了非 MustRegister 的能力**（主证） |
| `该工具不在内建清单` | capability map / admin 里它带 **origin=managed 徽章**，跟内建徽章可区分（呼应你问的「怎么区分」） |
| `插件 server 挂了，chat 不崩` | 进会话时插件不可达 → chat 正常用别的工具，插件工具缺席，**无 stack trace / 友好降级** |
| `version 不符的插件，不注册，其余正常` | 配置里塞一条不兼容 version → 它不出现，其余 chat 正常 |
| `插件撞内建 id → 内建赢` | 配置声明一个跟内建撞 id 的插件 → chat 调到的是**内建行为**，插件被拒（boot log 可查） |
| `stdio 插件也能被发现调用` | 同一 mock server `--stdio` 由 backend spawn → 工具同样可用（覆盖 stdio 端到端） |

**「中间出错」矩阵齐了：** 发现期挂（不可达 / version 不符 / 撞名）、调用期挂（C3 的 call-fail 折 tool_result，e2e 里表现为 AI 收到错误自己换路答）、会话中途挂（C2 的进程退出）。

**决策点 T.6：C4 的第一条 e2e 是本 feature 主证；origin 徽章那条直接回答「内建 vs 插件怎么区分」。**

---

## 隔离 / 确定性

- 每个 spec 走现有 `resetInstance` + 独立 owner/code，不跟别的 spec 共享插件配置。
- mock 插件的故障开关是**进程级 env**，spec 起不同配置的 server 实例，不靠运行时切状态（避免跨 spec race —— 见 `no-rerun-on-flake` 教训）。
- e2e 等 UI 状态 / 网络响应，零 `setTimeout`-as-sleep；unit 零 if。

**决策点 T.7：故障注入靠「起一个带该 env 的 server 实例」，不靠运行时管理端切状态。**
