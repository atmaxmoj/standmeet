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

import mcpgoserver "github.com/mark3labs/mcp-go/server"

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

// Transport kind 取值。
const (
	// TransportStdio —— core spawn 子进程，走 stdin/stdout（第三方插件）。
	TransportStdio = "stdio"
	// TransportHTTP —— 连 URL（第三方插件）。
	TransportHTTP = "http"
	// TransportInProcess —— 同进程内的 mcp-go server 对象（随产品发的内建能力，
	// 代码解耦在外、运行时在进程里）。InProcessServer 在 composition root 用代码
	// 填，不经 JSON manifest（Go 对象进不了 JSON）。
	TransportInProcess = "in_process"
	// TransportSandboxStdio —— 第三方 stdio server，但 **主进程把它起在一个受限
	// docker 沙箱里**（只读根、--tmpfs、只挂自己的插件目录、默认无网），而不是裸
	// spawn。Command/Args 是容器内的启动命令；沙箱细节在 Transport.Sandbox。stdio
	// 透明走 docker -i pipe，dial 跟普通 stdio 同一条路（只是命令被包了一层 docker）。
	TransportSandboxStdio = "sandbox_stdio"
)

// Sandbox —— kind=sandbox_stdio 时的沙箱声明（来自 JSON manifest）。PluginDir 是
// 宿主上该 server 的安装目录（owner 装插件就装进这里），bubblewrap 只读挂进沙箱的
// /plugin —— 那个「特定目录」就是沙箱；解释器用 host 的只读 /usr，不需要镜像。
// AllowNet 仅放给真正要 egress 的（yt-dlp 那类），默认无网。
type Sandbox struct {
	PluginDir string
	// HostSockets —— 宿主 unix socket bind 进沙箱（数据型内建经它够到后端窄 API，
	// 断网也可达）。非空 = 这是个需要后端数据的内建 → host 会把可信 session 上下文
	// 经 tool-call `_meta` 递给它；第三方插件（无 HostSockets）拿不到 session 上下文。
	HostSockets []string
	AllowNet    bool
	// Workspace —— true = 这个 server 要一块**持久的 per-visitor-session 工作区**
	// （写文件那类，如 server-filesystem）。host 按 conversation_id 懒建一个目录、
	// bwrap --bind 进沙箱的 /workspace（可写）；不写就没目录。这块区有后端可控的 TTL +
	// cron 清扫（#148），不会无限涨。默认 false（无持久工作区，只有 ephemeral tmpfs /tmp）。
	Workspace bool
}

// Transport —— 插件的 MCP 传输声明：stdio 用 Command/Args/Env；http 用 URL/Headers；
// in_process 用 InProcessServer（随产品发的内建能力，composition root 在代码里填一个
// 同进程 mcp-go server 对象）。三种走同一条注册/dial 路径（归一），只是 dial 时按 Kind
// 分流。
type Transport struct {
	Env     map[string]string
	Headers map[string]string
	// InProcessServer —— kind=in_process 时的同进程 *mcp-go server.MCPServer。
	// json:"-"：Go 对象不进 JSON 配置，只由 composition root 代码填。
	InProcessServer *mcpgoserver.MCPServer `json:"-"`
	// Sandbox —— kind=sandbox_stdio 时的受限容器声明（来自 JSON）。
	Sandbox *Sandbox
	Kind    string
	Command string
	URL     string
	Args    []string
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

// OwnerTool —— 插件暴露给 **owner 侧** 的一个工具,纯**声明数据**(名字/描述/入参 schema)。
//
// 为什么是数据而不是 dial 出来的:owner MCP 的工具表在装配期就要枚举(facade-parity 也照它对
// 账),若靠 dial 就得在启动时把沙箱拉起来。声明是数据、实现在沙箱 —— 正是两条插件轴的
// {declaration(data) → implementation → instance} 元结构;host 只在**真被调用时**才 dial。
//
// Name 是 owner MCP 上的对外名(如 "calendar.list_slots");Tool 是插件内部的 MCP 工具名
// (如 "calendar_list_slots")。两者分开,让 owner 面的命名规范不绑死插件内部命名。
type OwnerTool struct {
	Name        string
	Tool        string
	Description string
	InputSchema string
}

// Manifest —— 一条校验通过的 MCP 插件声明。
type Manifest struct {
	Requires []string
	// OwnerTools —— 本插件在 owner 侧暴露的工具声明(Shape 含 owner 时才有意义)。
	OwnerTools []OwnerTool
	// Config —— 本插件的可配置项声明。owner 面板按它渲染,值存进本插件自己的隔离存储。
	// 空 = 这个能力没有可调的东西。
	Config  []ConfigField
	ID      string
	Version string
	// Title —— 人类可读显示名（#109/#110 dock 按钮 label 透传它）。跟 MCP tool title 同角色：
	// 显示用，区别于程序标识 ID。空 = 该能力没 title（不够格当 dock 按钮 label，无 id 兜底）。
	Title            string
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
