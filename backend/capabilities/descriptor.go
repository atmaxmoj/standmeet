// descriptor.go —— manifest.yaml 的形状。
//
// 它跟 mcpplugin.Manifest 是**两个东西**:这边是磁盘上的写法(YAML 标签、可省字段、
// JSON Schema 用块标量原样写),那边是宿主用的形状。中间那层翻译在 loader.go,只有一处。

package capabilities

import "github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"

// descriptor —— 一个能力的完整声明。
type descriptor struct {
	Transport    transportDesc   `yaml:"transport"`
	Quota        quotaDesc       `yaml:"quota"`
	ClaimGate    claimGateDesc   `yaml:"claim_gate"`
	ID           string          `yaml:"id"`
	Title        string          `yaml:"title"`
	Version      string          `yaml:"version"`
	Shape        string          `yaml:"shape"`
	ACL          string          `yaml:"acl"`
	Requires     []string        `yaml:"requires"`
	VisitorTools []string        `yaml:"visitor_tools"`
	OwnerTools   []ownerToolDesc `yaml:"owner_tools"`
	Config       []fieldDesc     `yaml:"config"`
	CodeConfig   []fieldDesc     `yaml:"code_config"`
	RoleConfig   []fieldDesc     `yaml:"role_config"`
	RawToolNames bool            `yaml:"raw_tool_names"`
}

// transportDesc —— 怎么把这个能力跑起来。
type transportDesc struct {
	Env     map[string]string `yaml:"env"`
	Headers map[string]string `yaml:"headers"`
	Sandbox *sandboxDesc      `yaml:"sandbox"`
	Kind    string            `yaml:"kind"`
	Command string            `yaml:"command"`
	URL     string            `yaml:"url"`
	Args    []string          `yaml:"args"`
}

// sandboxDesc —— 隔离声明。**没有 socket 路径这一项** —— 路径由 id 派生,装载器注入。
type sandboxDesc struct {
	PluginDir string   `yaml:"plugin_dir"`
	HostOps   []string `yaml:"host_ops"`
	AllowNet  bool     `yaml:"allow_net"`
	Workspace bool     `yaml:"workspace"`
}

// ownerToolDesc —— owner 面的一个工具。input_schema 是 JSON Schema,按 JSON 原样写。
type ownerToolDesc struct {
	Name        string `yaml:"name"`
	Tool        string `yaml:"tool"`
	Description string `yaml:"description"`
	InputSchema string `yaml:"input_schema"`
}

// fieldDesc —— 一个配置项(owner 面的和码上的同一套)。
type fieldDesc struct {
	Min         *int   `yaml:"min"`
	Max         *int   `yaml:"max"`
	Key         string `yaml:"key"`
	Label       string `yaml:"label"`
	Type        string `yaml:"type"`
	Description string `yaml:"description"`
	Default     string `yaml:"default"`
}

// quotaDesc —— per-code 用量上限的三句话。三句不齐 → 不闸(宿主数不出用量时,"不闸"比
// "瞎闸"对)。
type quotaDesc struct {
	ConfigKey  string `yaml:"config_key"`
	Collection string `yaml:"collection"`
	CodeField  string `yaml:"code_field"`
}

// manifest —— 三句话齐了才给出一份声明;没声明 quota 的能力得到 nil。
func (q quotaDesc) manifest() *mcpplugin.QuotaDecl {
	decl := &mcpplugin.QuotaDecl{
		ConfigKey: q.ConfigKey, Collection: q.Collection, CodeField: q.CodeField,
	}
	if !decl.Usable() {
		return nil
	}
	return decl
}

// claimGateDesc —— 「说了就得做」的两句话:哪个工具算回执、哪些说法算主张。
type claimGateDesc struct {
	Tool    string   `yaml:"tool"`
	Phrases []string `yaml:"phrases"`
}

// manifest —— 两句话齐了才给出一份声明;没声明 claim_gate 的能力得到 nil。
func (c claimGateDesc) manifest() *mcpplugin.ClaimGateDecl {
	decl := &mcpplugin.ClaimGateDecl{Tool: c.Tool, Phrases: c.Phrases}
	if !decl.Usable() {
		return nil
	}
	return decl
}
