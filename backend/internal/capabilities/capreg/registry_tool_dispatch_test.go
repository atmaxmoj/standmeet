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

// 假能力与它们的 tool 名。取名字而不是到处写字面量:哪个能力提供哪个 tool 是这些用例的
// 全部内容,散成字符串就看不出 capA 的 tool 和 capB 的 tool 是两拨。
const (
	capA      = "plugin.a"
	capB      = "plugin.b"
	capC      = "plugin.c"
	toolAOne  = "a_one"
	toolATwo  = "a_two"
	toolBSend = "b_send"
	toolCOnly = "c_only"
)

// 三个能力,访客点的是第二个的按钮 —— 另外两个一次都不该被起起来。
func TestAssembleVisitorForTool_DialsOnlyTheOwner(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap(capA, &dials, &states, toolAOne, toolATwo))
	reg.MustRegister(newCap(capB, &dials, &states, toolBSend))
	reg.MustRegister(newCap(capC, &dials, &states, toolCOnly))

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), toolBSend)

	require.Equal(t, 1, dials,
		"one button press must spawn one sandbox, not one per capability")
	require.Len(t, bindings, 1)
	require.Equal(t, toolBSend, bindings[0].Tools[0].Name)
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
	reg.MustRegister(newCap(capA, &dials, &states, toolAOne))
	reg.MustRegister(newCap(capB, &dials, &states, toolBSend))

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "no_such_tool")

	require.Empty(t, bindings)
	require.Equal(t, 0, dials, "a tool nobody serves must spawn no sandbox at all")
}

// MCPIDForTool —— 一张卡读写自己那格 app-state,只是要知道"这个 tool 属于哪个 mcp"。
//
// 这是第三条同类的路(前两条:单次工具调用、会话打开)。`GET/PUT /sessions/{id}/app-state/{tool}`
// 原来先 AssembleVisitor 全量装配一遍,只为从 binding 里把 tool 名映射成 capability id ——
// 卡片每动一下,整排外置能力的沙箱冷启一次。实测一次 app-state 读花了 6 秒,卡片内容一直空着。
//
// 名字→归属是**静态信息**,大多数能力不拨号就说得出(ToolNameKnower);说不出的才拨。
// 所以这里数的还是拨号次数:一格 app-state 最多拨一次,理想是零。
func TestMCPIDForTool_DoesNotDialEverybody(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap(capA, &dials, &states, toolAOne, toolATwo))
	reg.MustRegister(newCap(capB, &dials, &states, toolBSend))
	reg.MustRegister(newCap(capC, &dials, &states, toolCOnly))

	id, ok := reg.MCPIDForTool(context.Background(), input(), toolBSend)

	require.True(t, ok, "the tool is served by "+capB)
	require.Equal(t, capB, id, "app-state buckets by the owning capability id")
	require.LessOrEqual(t, dials, 1,
		"reading one card's app-state must not spawn a sandbox per capability")
}

// 同一个 mcp 的多个 tool 映到同一格(calendar_book / calendar_list_slots 共享)。
func TestMCPIDForTool_SiblingToolsShareOneBucket(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap(capA, &dials, &states, toolAOne, toolATwo))

	first, ok1 := reg.MCPIDForTool(context.Background(), input(), toolAOne)
	second, ok2 := reg.MCPIDForTool(context.Background(), input(), toolATwo)

	require.True(t, ok1)
	require.True(t, ok2)
	require.Equal(t, first, second, "two tools of one capability share one app-state bucket")
}

// 没人提供的 tool → caller 回 tool_not_enabled,而且一个沙箱都不该起。
func TestMCPIDForTool_UnknownToolDialsNobody(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap(capA, &dials, &states, toolAOne))

	id, ok := reg.MCPIDForTool(context.Background(), input(), "no_such_tool")

	require.False(t, ok)
	require.Empty(t, id)
	require.Equal(t, 0, dials, "a tool nobody serves must spawn no sandbox at all")
}

// 回一份 state 不需要一个会话。这是那 2N 里的另一个 N:工具跑完前端要立刻看到
// quota 变化,原来为了这个把每个能力又起了一遍。
func TestVisitorStates_DoesNotDialStateReporters(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newCap(capA, &dials, &states, toolAOne))
	reg.MustRegister(newCap(capB, &dials, &states, toolBSend))

	out := reg.VisitorStates(context.Background(), input())

	require.Len(t, out, 2, "both capabilities must still appear in the state list")
	require.Equal(t, 0, dials, "reporting state must not spawn a sandbox")
	require.Equal(t, 2, states)
}
