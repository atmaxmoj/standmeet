// Package capload —— capability 轴的**装载/派发 glue**:把各来源的能力(owner 注册的外部
// MCP server、装的 skill、OpenAPI agent 工具、MCP-app 会话)适配成 capreg 里的统一能力,
// 供访客 agent 调度。原先散在 internal/usecases(by-layer god-package),按
// backend-domain-modules.md「capreg 不是公用的,是 capability 轴的」归到 capabilities 下。
//
// 它是 capability 轴的**实现侧机制**(loader/adapter),不是具体能力本身 —— 具体能力仍外置
// (mcp-servers/ 沙箱 或 owner 侧插件)。glue 经窄口(conversation.VisitorSkillsDeps /
// MCPServerGetter / SkillGetter 等)从各 domain 取料,由 composition root 注入,不反被 domain 依赖。
package capload
