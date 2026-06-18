// agentskills_plugin.go —— C3: pluginCapability 适配器(泛化 ext-mcp)。
// 把一条 mcpplugin.Manifest 适配成 agentskills.Capability:VisitorBinding 时按
// transport dial 插件 → ListTools → 每个 tool 包成 BindingTool;_meta.ui 进
// CapabilityState.Extra。ext-mcp 退化成它的一个特例(owner 运行时来源)。
//
// 现为 stub(红)—— C0 先写测试,C3 实现。
package usecases

import (
	"context"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

// errPluginCapNotImpl —— C3 未实现的占位错误(让 C0 测试红得干净,且区别于
// ErrHidden —— 否则 DialFailHidden 会假绿)。
var errPluginCapNotImpl = errors.New("usecases: pluginCapability not implemented (C3)")

type pluginCapability struct {
	m mcpplugin.Manifest
}

func newPluginCapability(m mcpplugin.Manifest) *pluginCapability {
	return &pluginCapability{m: m}
}

func (c *pluginCapability) ID() string { return c.m.ID }

func (c *pluginCapability) Shape() agentskills.Shape {
	return agentskills.Shape(string(c.m.Shape))
}

func (*pluginCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{}
}

func (*pluginCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (*pluginCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— dial 插件 → list → wrap。C3 实现;现 stub 返非 ErrHidden 错。
func (*pluginCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return nil, errPluginCapNotImpl
}
