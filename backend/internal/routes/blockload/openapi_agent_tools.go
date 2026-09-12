// openapi_agent_tools.go —— #155 §3, the second consumer path: an openapi
// supplier's raw operations exposed as per-session agent tools (op_<operationId>). A
// registry.Fiber whose VisitorBinding enumerates the owner's openapi suppliers that are
// connected + expose_as_agent_tools, turning each operation into an LLM tool (description
// taken from the operation summary); at runtime it calls the SaaS for that op, injects auth,
// and returns the raw response (no contract, no mapping).
//
// Gated (same gate as every other block): (a) the supplier is connected (already filtered by
// source); (b) that op's tool name is in this session's allowed_tools (per-op grant). A
// supplier bound purely to a seam (with no expose) never enters source → its raw ops are
// never leaked ([A5]).

package blockload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

const blockOpenapiAgentTools = "supplier.agent_tools"

// errAgentOpFailed —— the clean tool error for a failed agent-tool run (leaks no
// underlying SaaS/auth details to the LLM).
var errAgentOpFailed = errors.New("the operation could not be completed")

// agentToolArgsSchema —— a loose object input schema (no contract on the agent path; the
// LLM constructs the body freely per operation).
var agentToolArgsSchema = json.RawMessage(`{"type":"object"}`)

// AgentOp / AgentToolSource —— what this loader needs a supplier to answer, stated by the
// loader itself.
//
// The conversation domain declares a port of the same shape, and the supplier layer declares a
// third. That is three interfaces with the same methods and three different owners, on purpose:
// each side names what IT needs or offers, nobody imports anybody, and the composition root is
// where they are introduced. Naming the domain's type here instead would make this loader import
// a domain — which is the thing the outbound convergence point exists to prevent, and which two
// separate gates catch (routes-via-dispatcher and domain-facade-boundary) the moment it happens.
type AgentOp struct {
	Name        string
	OpID        string
	Description string
}

// AgentToolSource —— one supplier the owner opted in as an agent tool.
type AgentToolSource interface {
	AgentOps() []AgentOp
	CallAgentOp(
		ctx context.Context, ownerID, opID string, args json.RawMessage,
	) (json.RawMessage, error)
}

// AgentToolSupplierSource —— the owner's openapi suppliers that are connected and
// expose_as_agent_tools. The composition root adapts the credentials repo's ListByOwner +
// the supplier table (type-asserting AgentToolSupplier).
type AgentToolSupplierSource interface {
	AgentToolSources(ctx context.Context, ownerID string) ([]AgentToolSource, error)
}

type openapiAgentToolsFiber struct {
	src AgentToolSupplierSource
}

func newOpenapiAgentToolsFiber(src AgentToolSupplierSource) *openapiAgentToolsFiber {
	return &openapiAgentToolsFiber{src: src}
}

func (*openapiAgentToolsFiber) ID() string { return blockOpenapiAgentTools }

func (*openapiAgentToolsFiber) Shape() registry.Shape { return registry.ShapeVisitorOnly }

func (*openapiAgentToolsFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{}
}

func (*openapiAgentToolsFiber) SystemPromptFragment(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

func (*openapiAgentToolsFiber) SystemPromptFragmentID(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— enumerates the owner's agent-tool suppliers → one tool per granted op.
// Nothing to expose → ErrHidden.
func (c *openapiAgentToolsFiber) VisitorBinding(
	ctx context.Context, in *registry.AssembleInput,
) (*registry.Binding, error) {
	sources, err := c.src.AgentToolSources(ctx, in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("agent tool sources: %w", err)
	}
	granted := grantedSet(in.RoleSnapshot.AllowedTools())
	var tools []registry.BindingTool
	for _, src := range sources {
		tools = append(tools, grantedOpTools(src, granted, in.OwnerID)...)
	}
	if len(tools) == 0 {
		return nil, registry.ErrHidden
	}
	return &registry.Binding{
		Tools: tools,
		State: registry.FiberState{ID: blockOpenapiAgentTools, Enabled: true},
	}, nil
}

// grantedOpTools —— the ops within one supplier that this session has granted (op_<id> is
// in allowed_tools) → LLM tools.
func grantedOpTools(
	src AgentToolSource, granted map[string]bool, ownerID string,
) []registry.BindingTool {
	var tools []registry.BindingTool
	for _, op := range src.AgentOps() {
		if granted[op.Name] {
			tools = append(tools, agentOpTool(src, op, ownerID))
		}
	}
	return tools
}

// agentOpTool —— one op → one LLM tool. Run calls the SaaS with the LLM's args used verbatim
// as the request body and returns the raw response (the agent path: the LLM consumes the
// SaaS shape directly); on failure → a clean tool error (nothing about the underlying cause
// leaks), passed to the LLM by the agent loop.
func agentOpTool(
	src AgentToolSource, op AgentOp, ownerID string,
) registry.BindingTool {
	opID := op.OpID
	run := func(ctx context.Context, argsJSON string) (string, error) {
		raw, cerr := src.CallAgentOp(ctx, ownerID, opID, json.RawMessage(argsJSON))
		if cerr != nil {
			return "", errAgentOpFailed
		}
		return string(raw), nil
	}
	return registry.NewTool(op.Name, op.Description, "", agentToolArgsSchema, run)
}

func grantedSet(names []string) map[string]bool {
	out := make(map[string]bool, len(names))
	for _, n := range names {
		out[n] = true
	}
	return out
}
