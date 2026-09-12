// registry_tool_dispatch_test.go —— a visitor pressing one card button should
// spawn **one** sandbox, not more.
//
// This guard locks down a degradation that only shows up under load: one POST
// /sessions/{id}/tools/{name} used to instantiate every block once
// (AssembleVisitor), then, to return a FiberState afterward, instantiate
// every one of them again (VisitorStates) — one click, 2N dials, where N is the
// number of installed externalized blocks. Externalized block
// instantiation spawns a bwrap sandbox, ~1s idle, measured up to 19 seconds when
// the machine is under load.
//
// So what's counted here is **dial count**, not duration: duration drifts with
// the machine, dial count is structural. Each of the two paths owns its own N:
//   - AssembleVisitorForTool only dials blocks that might serve that tool
//   - VisitorStates never dials a StateReporter at all

package registry_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// dialCountingFiber —— a bookkeeping fake block: each VisitorBinding call
// counts one "dial" and exposes the tools in toolNames. knowsNames=false
// simulates "hasn't been dialed yet, can't say what tools it has".
type dialCountingFiber struct {
	dials      *int
	stateCalls *int
	id         string
	toolNames  []string
	knowsNames bool
}

func (c *dialCountingFiber) ID() string          { return c.id }
func (*dialCountingFiber) Shape() registry.Shape { return registry.ShapeVisitorOnly }

func (c *dialCountingFiber) VisitorBinding(
	_ context.Context, _ *registry.AssembleInput,
) (*registry.Binding, error) {
	*c.dials++
	tools := make([]registry.BindingTool, 0, len(c.toolNames))
	for _, n := range c.toolNames {
		tools = append(tools, registry.NewTool(n, n, "", nil, nil))
	}
	return &registry.Binding{
		Tools: tools,
		State: registry.FiberState{ID: c.id, Enabled: true},
	}, nil
}

func (*dialCountingFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{}
}

func (*dialCountingFiber) SystemPromptFragment(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

func (*dialCountingFiber) SystemPromptFragmentID(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

// KnownToolNames —— registry.ToolNameKnower. knowsNames=false = not dialed yet.
func (c *dialCountingFiber) KnownToolNames() ([]string, bool) {
	if !c.knowsNames {
		return []string{}, false
	}
	return c.toolNames, true
}

// VisitorStateOnly —— registry.StateReporter: reports state without dialing.
func (c *dialCountingFiber) VisitorStateOnly(
	_ context.Context, _ *registry.AssembleInput,
) (registry.FiberState, bool) {
	*c.stateCalls++
	return registry.FiberState{ID: c.id, Enabled: true}, true
}

func newBlock(id string, dials, states *int, names ...string) *dialCountingFiber {
	return &dialCountingFiber{
		id: id, dials: dials, stateCalls: states,
		toolNames: names, knowsNames: true,
	}
}

func input() *registry.AssembleInput {
	return &registry.AssembleInput{OwnerID: "owner-1", Mode: "code"}
}

// Fake blocks and their tool names. Named constants instead of literals
// scattered everywhere: which block serves which tool IS the whole point of
// these test cases, and scattered string literals would hide that blockA's tools
// and blockB's tools are two separate groups.
const (
	blockA    = "plugin.a"
	blockB    = "plugin.b"
	blockC    = "plugin.c"
	toolAOne  = "a_one"
	toolATwo  = "a_two"
	toolBSend = "b_send"
	toolCOnly = "c_only"
)

// Three blocks, the visitor presses the second one's button — the other
// two must never be spun up, not even once.
func TestAssembleVisitorForTool_DialsOnlyTheOwner(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newBlock(blockA, &dials, &states, toolAOne, toolATwo))
	reg.MustRegister(newBlock(blockB, &dials, &states, toolBSend))
	reg.MustRegister(newBlock(blockC, &dials, &states, toolCOnly))

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), toolBSend)

	require.Equal(t, 1, dials,
		"one button press must spawn one sandbox, not one per block")
	require.Len(t, bindings, 1)
	require.Equal(t, toolBSend, bindings[0].Tools[0].Name)
}

// A block that still can't say what tools it has (its first cold start)
// must still be dialed — better a wasted dial than a missed one: missing it
// means the visitor gets block_not_enabled and a block vanishes for no
// reason.
func TestAssembleVisitorForTool_DialsUnknownCaps(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	cold := newBlock("plugin.cold", &dials, &states, "cold_tool")
	cold.knowsNames = false
	reg.MustRegister(cold)

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "cold_tool")

	require.Equal(t, 1, dials, "a block that does not know its tool names yet must be dialed")
	require.Len(t, bindings, 1)
}

// A block that doesn't implement ToolNameKnower (the builtin in-process
// kind) is likewise dialed regardless — here it's wrapped in an anonymous struct
// that only exposes Fiber, so neither optional interface type-asserts.
func TestAssembleVisitorForTool_DialsCapsWithoutTheInterface(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(struct{ registry.Fiber }{
		Fiber: newBlock("plugin.plain", &dials, &states, "plain_tool"),
	})

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "plain_tool")

	require.Equal(t, 1, dials)
	require.Len(t, bindings, 1)
}

// When nothing is found, the caller must be able to return
// block_not_enabled — and none of the blocks with known tool names
// should be dialed (dialing them would be wasted anyway).
func TestAssembleVisitorForTool_UnknownToolDialsNobody(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newBlock(blockA, &dials, &states, toolAOne))
	reg.MustRegister(newBlock(blockB, &dials, &states, toolBSend))

	bindings := reg.AssembleVisitorForTool(context.Background(), input(), "no_such_tool")

	require.Empty(t, bindings)
	require.Equal(t, 0, dials, "a tool nobody serves must spawn no sandbox at all")
}

// MCPIDForTool —— a card reading or writing its own app-state slot only needs
// to know "which mcp does this tool belong to".
//
// This is the third path in the same family (the first two: single tool call,
// session open). `GET/PUT /sessions/{id}/app-state/{tool}` used to run a full
// AssembleVisitor just to map a tool name to a block id from the bindings —
// every time a card moved, the whole row of externalized block sandboxes
// cold-started. Measured, one app-state read took 6 seconds while the card's
// content stayed empty.
//
// Name → owner is **static information**; most blocks can state it without
// dialing (ToolNameKnower); only the ones that can't get dialed. So what's
// counted here is still dial count: reading one app-state slot dials at most
// once, ideally zero.
func TestMCPIDForTool_DoesNotDialEverybody(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newBlock(blockA, &dials, &states, toolAOne, toolATwo))
	reg.MustRegister(newBlock(blockB, &dials, &states, toolBSend))
	reg.MustRegister(newBlock(blockC, &dials, &states, toolCOnly))

	id, ok := reg.MCPIDForTool(context.Background(), input(), toolBSend)

	require.True(t, ok, "the tool is served by "+blockB)
	require.Equal(t, blockB, id, "app-state buckets by the owning block id")
	require.LessOrEqual(t, dials, 1,
		"reading one card's app-state must not spawn a sandbox per block")
}

// Several tools of the same mcp map to the same slot (calendar_book /
// calendar_list_slots share one).
func TestMCPIDForTool_SiblingToolsShareOneBucket(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newBlock(blockA, &dials, &states, toolAOne, toolATwo))

	first, ok1 := reg.MCPIDForTool(context.Background(), input(), toolAOne)
	second, ok2 := reg.MCPIDForTool(context.Background(), input(), toolATwo)

	require.True(t, ok1)
	require.True(t, ok2)
	require.Equal(t, first, second, "two tools of one block share one app-state bucket")
}

// A tool nobody serves → the caller returns tool_not_enabled, and not a single
// sandbox should spin up.
func TestMCPIDForTool_UnknownToolDialsNobody(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newBlock(blockA, &dials, &states, toolAOne))

	id, ok := reg.MCPIDForTool(context.Background(), input(), "no_such_tool")

	require.False(t, ok)
	require.Empty(t, id)
	require.Equal(t, 0, dials, "a tool nobody serves must spawn no sandbox at all")
}

// Returning a state doesn't need a session. This is the other N of that 2N:
// after a tool runs, the frontend needs to see the quota change immediately, and
// this used to spin up every block again just for that.
func TestVisitorStates_DoesNotDialStateReporters(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()
	dials, states := 0, 0
	reg.MustRegister(newBlock(blockA, &dials, &states, toolAOne))
	reg.MustRegister(newBlock(blockB, &dials, &states, toolBSend))

	out := reg.VisitorStates(context.Background(), input())

	require.Len(t, out, 2, "both blocks must still appear in the state list")
	require.Equal(t, 0, dials, "reporting state must not spawn a sandbox")
	require.Equal(t, 2, states)
}
