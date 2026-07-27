// Package capabilities —— standmeet 自己的 agent(访客 agent)装载/调度 MCP **能力**的机制轴
// (对齐 backend-domain-modules.md 类图的 capability 轴:声明 → 实现 → 实例 → 一扇不透明门)。
//
// 这里装的是"能力"这条轴的机制,子包:
//   - capreg     —— 能力**声明**注册表(boot 插件 + owner 注册的 MCP / 装的 skill)。
//   - capsocket  —— host 侧回调 socket:断网沙箱能力经 bind 进的窄口回调后端 op。
//   - mcpclient  —— 我方作 **client** 拨号**外部** owner-registered MCP server 的传输。
//   - mcpplugin  —— 装机插件 manifest 解析 + 发现来源。
//   - mcputil    —— 能力工具返回值的共享 marshaller。
//   - capstore   —— per-plugin 隔离的 JSONB 存储(每能力/连接器一 schema)。
//
// 明确边界(别把东西错放进来):
//   - **不是 connector**。connector 是另一条轴 —— owner 带凭据的外部集成(gcal/smtp/…),
//     解密凭据代调外部服务。凭据永不出 connector。capabilities 只经 connector 的不透明门
//     按 name 反查(connector-deps),自己不碰 token。
//   - **不是给外部 agent 访问 standmeet 的入口**。那是 routes/mcphandle 的 MCP **server**
//     facade(把 owner 工具聚合成一个对外端点)。capabilities 是反方向:我方 agent 往外/往
//     沙箱装载并调用能力。
//
// 能力的**实现**不在这里:sandboxed leaf(booker/retrieval/summarize/…)住 top-level
// mcp-servers/;owner 侧可信能力(ownercore/jobs)归 owner 模块。这里只有轴的机制。
//
// 铁律:capabilities **禁止出现任何具体 MCP 能力**。所有具体能力一律外置(沙箱进程
// mcp-servers/ 或 owner 侧插件);本包只留**通用装载基建** —— 注册表 / 传输 / socket /
// 存储 / manifest。光看这个包,认不出任何一个外置能力(booker/retrieval/summarize/
// mail-sender/ask-visitor/…)存在。check-core-agnostic 棘轮结构性守住(命中 = 红)。
// (ghost 不在此列 —— 它是 conversation 的核心功能,不是外置 MCP 能力。)
package capabilities
