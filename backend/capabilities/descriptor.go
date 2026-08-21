// descriptor.go —— manifest.yaml 的形状。
//
// 它跟 mcpplugin.Manifest 是**两个东西**:这边是磁盘上的写法(YAML 标签、可省字段、
// JSON Schema 用块标量原样写),那边是宿主用的形状。中间那层翻译在 loader.go,只有一处。

package capabilities

import (
	"fmt"

	yaml "go.yaml.in/yaml/v3"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// descriptor —— 一个能力的完整声明。
type descriptor struct {
	Transport    transportDesc     `yaml:"transport"`
	Quota        quotaDesc         `yaml:"quota"`
	ClaimGate    claimGateDesc     `yaml:"claim_gate"`
	ID           string            `yaml:"id"`
	Title        string            `yaml:"title"`
	Version      string            `yaml:"version"`
	Shape        string            `yaml:"shape"`
	ACL          string            `yaml:"acl"`
	Requires     []string          `yaml:"requires"`
	VisitorTools []visitorToolDesc `yaml:"visitor_tools"`
	OwnerTools   []ownerToolDesc   `yaml:"owner_tools"`
	Config       []fieldDesc       `yaml:"config"`
	CodeConfig   []fieldDesc       `yaml:"code_config"`
	RoleConfig   []fieldDesc       `yaml:"role_config"`
	RawToolNames bool              `yaml:"raw_tool_names"`
}

// visitorToolDesc —— `visitor_tools` 的一项。**两种写法都收**：
//
//	visitor_tools:
//	  - calendar_list_slots            # 只要能力级 requires 就够（只读也能用）
//	  - name: calendar_book            # 这一个动作还额外要什么
//	    requires: [calendar:events.insert]
//
// 为什么要 per-tool 这一层（F-B-8 ⭐⭐）：能力级的 `requires: [calendar]` 只答得了
// 「连没连」。owner 只授 `calendar.readonly` 时连接是好的、列时段也是好的，**只有写会
// 永远 403** —— 而产品照旧把「订会」摆给访客。把整条 requires 提到写权限上又会**连列时段
// 一起藏掉**，那是拿掉一个本来能用的动作。所以粒度必须落到工具，跟产品在邮件那边的做法一致：
// 确认邮件那一块不渲染，预约本身照旧在。
type visitorToolDesc struct {
	Name     string   `yaml:"name"`
	Requires []string `yaml:"requires"`
}

// UnmarshalYAML —— 裸字符串 = 只有名字；映射 = 名字 + 这一个工具额外的 requires。
// 收两种写法是为了**不动**其余 4 个能力的 manifest：它们的 visitor_tools 全是裸名字，
// 而"顺手把它们也改成映射"会把一次机制补齐变成一次全域改写（[[externalize-is-not-relocate]]
// 的反面：这里要的正是只加机制、不搬家）。
func (v *visitorToolDesc) UnmarshalYAML(value *yaml.Node) error {
	if value.Kind == yaml.ScalarNode {
		v.Requires = nil
		if err := value.Decode(&v.Name); err != nil {
			return fmt.Errorf("visitor_tools: %w", err)
		}
		return nil
	}
	type raw struct {
		Name     string   `yaml:"name"`
		Requires []string `yaml:"requires"`
	}
	var r raw
	if err := value.Decode(&r); err != nil {
		return fmt.Errorf("visitor_tools entry: %w", err)
	}
	v.Name, v.Requires = r.Name, r.Requires
	return nil
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

// quotaDesc —— per-**主体**用量上限的三句话。三句不齐 → 不闸(宿主数不出用量时,"不闸"比
// "瞎闸"对)。主体可以是一张码,也可以是一把对外 API key(F-B-11)。
type quotaDesc struct {
	ConfigKey    string `yaml:"config_key"`
	Collection   string `yaml:"collection"`
	SubjectField string `yaml:"subject_field"`
}

// manifest —— 三句话齐了才给出一份声明;没声明 quota 的能力得到 nil。
func (q quotaDesc) manifest() *mcpplugin.QuotaDecl {
	decl := &mcpplugin.QuotaDecl{
		ConfigKey: q.ConfigKey, Collection: q.Collection, SubjectField: q.SubjectField,
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
