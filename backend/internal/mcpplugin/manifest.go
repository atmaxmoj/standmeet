// Package mcpplugin —— 标准 MCP 插件的 manifest + 装机发现来源（Phase A / C1）。
//
// 装机配置（STANDMEET_PLUGINS 指向的 JSON，形如 Claude Desktop mcpServers）
// 声明一组 MCP 插件；core 启动时解析 + 版本闸 + 逐条校验，产出可注册的
// []Manifest。这里是**纯数据层** —— 不 dial、不注册、不碰 transport。
// dial→list→wrap 在 C2/C3。设计见 docs/design/platform-architecture.md。
//
// 失败模型：整份 JSON 解析不了 → 返 error（fail-closed）；单条 manifest 校验
// 不过 → 跳过 + 进 Skipped（带 reason，fail-open per-manifest），其余照常。
// caller 负责把 Skipped log 出来（返回而非内部 log → 可测、无隐藏副作用）。
package mcpplugin

// SupportedVersion —— 本 core 认的 manifest schema 版本；插件 version 不等 → 拒。
const SupportedVersion = "1"

// Shape —— 插件暴露给哪一侧（与 capreg.Shape 取值一致，留独立类型让本包是 leaf）。
type Shape string

// Shape 枚举值。
const (
	ShapeVisitorOnly Shape = "visitor_only"
	ShapeOwnerOnly   Shape = "owner_only"
	ShapeBoth        Shape = "both"
)

// Transport —— 插件的 MCP 传输声明：stdio（core spawn 子进程）或 http（连 URL）。
// 二选一：kind=stdio 用 Command/Args/Env；kind=http 用 URL/Headers。
type Transport struct {
	Env     map[string]string
	Headers map[string]string
	Kind    string
	Command string
	URL     string
	Args    []string
}

// UI —— 可选 MCP Apps UI 资源（#134）：tool 在 chat 里渲染的 ui:// 卡片。
type UI struct {
	ResourceURI string
	MimeType    string
}

// ACL 取值 —— 插件工具对访客的暴露门。
const (
	// ACLRoleGranted —— 默认：role.AllowedTools 含本插件 ID 才暴露（echoer /
	// owner 注册的第三方 server 同此）。
	ACLRoleGranted = "role_granted"
	// ACLAlways —— 无条件暴露给所有 mode（public/code/byoai），不看 role 授权。
	// 外置的内建基础能力（如 ask_visitor）用这个，保住"所有 mode 都有"的语义。
	ACLAlways = "always"
)

// Manifest —— 一条校验通过的 MCP 插件声明。
type Manifest struct {
	UI               *UI
	Requires         []string
	ID               string
	Version          string
	Shape            Shape
	PromptFragmentID string
	// ACL —— 暴露门：ACLRoleGranted（默认）或 ACLAlways。
	ACL       string
	Transport Transport
	// RawToolNames —— true 时工具用 server 原名（不加 <id>_ 前缀）。外置的内建
	// 能力保留 canonical 名（ask_visitor 就叫 ask_visitor，不是 ask_visitor_ask_visitor）。
	// 默认 false：跟 ext-mcp 同样加前缀，避免多个第三方 server 撞名。
	RawToolNames bool
}
