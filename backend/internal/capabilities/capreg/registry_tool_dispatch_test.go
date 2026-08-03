// registry_tool_dispatch_test.go —— 访客点一次卡片按钮,应该只起**一个**沙箱。
//
// 这条 guard 锁的是一个只在负载下才现形的退化:一次 POST /sessions/{id}/tools/{name}
// 原来把每个能力都实例化一遍(AssembleVisitor),执行完为了回一份 CapabilityState 又
// 逐个实例化一遍(VisitorStates) —— 一次点击 2N 次拨号,N 是装上的外置能力数。外置能力
// 实例化 = 起一个 bwrap 沙箱,空闲时约 1s,机器压满时整段实测到过 19 秒。
//
// 所以这里数的是**拨号次数**,不是耗时:耗时随机器变,拨号次数是结构性的。
// 两条各自对应一个 N:
//   - AssembleVisitorForTool 只拨可能提供该 tool 的能力
//   - VisitorStates 对 StateReporter 完全不拨

package capreg_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// dialCountingCap —— 一个记账的假能力:每次 VisitorBinding 记一次"拨号",暴露
// toolNames 里那些 tool。knowsNames=false 模拟"还没拨过、说不出自己有什么 tool"。
type dialCountingCap struct {
	dials      *int
	stateCalls *int
	id         string
	toolNames  []string
	knowsNames bool
}

func (c *dialCountingCap) ID() string        { return c.id }
func (*dialCountingCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }

func (c *dialCountingCap) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	*c.dials++
	tools := make([]capreg.BindingTool, 0, len(c.toolNames))
	for _, n := range c.toolNames {
		tools = append(tools, capreg.NewTool(n, n, "", nil, nil))
	}
	return &capreg.Binding{
		Tools: tools,
		State: capreg.CapabilityState{ID: c.id, Enabled: true},
	}, nil
}

func (*dialCountingCap) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

func (*dialCountingCap) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*dialCountingCap) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// KnownToolNames —— capreg.ToolNameKnower。knowsNames=false = 还没拨过。
func (c *dialCountingCap) KnownToolNames() ([]string, bool) {
	if !c.knowsNames {
		return []string{}, false
	}
	return c.toolNames, true
}

// VisitorStateOnly —— capreg.StateReporter：不拨号就报 state。
func (c *dialCountingCap) VisitorStateOnly(
	_ context.Context, _ *capreg.AssembleInput,
) (capreg.CapabilityState, bool) {
	*c.stateCalls++
	return capreg.CapabilityState{ID: c.id, Enabled: true}, true
}

func newCap(id string, dials, states *int, names ...string) *dialCountingCap {
	return &dialCountingCap{
		id: id, dials: dials, stateCalls: states,
		toolNames: names, knowsNames: true,
	}
}

func input() *capreg.AssembleInput {
	return &capreg.AssembleInput{OwnerID: "owner-1", Mode: "code"}
}

// 三个能力,访客点的是第二个的按钮 —— 另外两个一次都不该被起起来。
func TestAssembleVisitorForTool_DialsOnlyTheOwner(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap("plugin.a", &dials, &states, "a_one", "a_two"))
	reg.MustRegister(newCap("plugin.b", &dials, &states, "b_send"))
	reg.MustRegister(newCap("plugin.c", &dials, &states, "c_only"))

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "b_send")

	require.Equal(t, 1, dials,
		"one button press must spawn one sandbox, not one per capability")
	require.Len(t, bindings, 1)
	require.Equal(t, "b_send", bindings[0].Tools[0].Name)
}

// 还说不出自己有什么 tool 的能力(冷启第一次)必须照拨 —— 宁可白拨,不能漏掉:
// 漏掉的话访客得到的是 capability_not_enabled,一个能力凭空消失。
func TestAssembleVisitorForTool_DialsUnknownCaps(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	cold := newCap("plugin.cold", &dials, &states, "cold_tool")
	cold.knowsNames = false
	reg.MustRegister(cold)

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "cold_tool")

	require.Equal(t, 1, dials, "a capability that does not know its tool names yet must be dialed")
	require.Len(t, bindings, 1)
}

// 没实现 ToolNameKnower 的能力(内建的 in-process 那类)同样照拨 —— 这里把它包在一个
// 只暴露 Capability 的匿名结构里,两个可选接口都断言不上。
func TestAssembleVisitorForTool_DialsCapsWithoutTheInterface(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(struct{ capreg.Capability }{
		Capability: newCap("plugin.plain", &dials, &states, "plain_tool"),
	})

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "plain_tool")

	require.Equal(t, 1, dials)
	require.Len(t, bindings, 1)
}

// 找不到时 caller 要能回 capability_not_enabled —— 而且已知 tool 名的能力一个都
// 不用拨(拨了也白拨)。
func TestAssembleVisitorForTool_UnknownToolDialsNobody(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap("plugin.a", &dials, &states, "a_one"))
	reg.MustRegister(newCap("plugin.b", &dials, &states, "b_send"))

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "no_such_tool")

	require.Empty(t, bindings)
	require.Equal(t, 0, dials, "a tool nobody serves must spawn no sandbox at all")
}

// 回一份 state 不需要一个会话。这是那 2N 里的另一个 N:工具跑完前端要立刻看到
// quota 变化,原来为了这个把每个能力又起了一遍。
func TestVisitorStates_DoesNotDialStateReporters(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap("plugin.a", &dials, &states, "a_one"))
	reg.MustRegister(newCap("plugin.b", &dials, &states, "b_send"))

	out := reg.VisitorStates(context.Background(), input())

	require.Len(t, out, 2, "both capabilities must still appear in the state list")
	require.Equal(t, 0, dials, "reporting state must not spawn a sandbox")
	require.Equal(t, 2, states)
}
