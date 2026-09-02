// capreg_openapi_agent_tools.go —— #155 §3, the second consumer path: an openapi
// connector's raw operations exposed as per-session agent tools (op_<operationId>). A
// capreg.Capability whose VisitorBinding enumerates the owner's openapi connectors that are
// connected + expose_as_agent_tools, turning each operation into an LLM tool (description
// taken from the operation summary); at runtime it calls the SaaS for that op, injects auth,
// and returns the raw response (no contract, no mapping).
//
// Gated (same gate as other caps): (a) the connector is connected (already filtered by
// source); (b) that op's tool name is in this session's allowed_tools (per-op grant). A
// connector bound purely by category (with no expose) never enters source → its raw ops are
// never leaked ([A5]).

package capload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
)

const capOpenapiAgentTools = "connector.agent_tools"

// errAgentOpFailed —— the clean tool error for a failed agent-tool run (leaks no
// underlying SaaS/auth details to the LLM).
var errAgentOpFailed = errors.New("the operation could not be completed")

// agentToolArgsSchema —— a loose object input schema (no contract on the agent path; the
// LLM constructs the body freely per operation).
var agentToolArgsSchema = json.RawMessage(`{"type":"object"}`)

// AgentConnectorSource —— the owner's openapi connectors that are connected and
// expose_as_agent_tools. The composition root adapts ConnectorRepo.ListByOwner + Hub
// (type-asserting AgentToolConnector).
type AgentConnectorSource interface {
	AgentConnectors(ctx context.Context, ownerID string) ([]consumer.AgentToolConnector, error)
}

type openapiAgentToolsCapability struct {
	src AgentConnectorSource
}

func newOpenapiAgentToolsCapability(src AgentConnectorSource) *openapiAgentToolsCapability {
	return &openapiAgentToolsCapability{src: src}
}

func (*openapiAgentToolsCapability) ID() string { return capOpenapiAgentTools }

func (*openapiAgentToolsCapability) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }

func (*openapiAgentToolsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

func (*openapiAgentToolsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*openapiAgentToolsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— enumerates the owner's agent connectors → one tool per granted op.
// Nothing to expose → ErrHidden.
func (c *openapiAgentToolsCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	conns, err := c.src.AgentConnectors(ctx, in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("agent connectors: %w", err)
	}
	granted := grantedSet(in.RoleSnapshot.AllowedTools())
	var tools []capreg.BindingTool
	for _, conn := range conns {
		tools = append(tools, grantedOpTools(conn, granted, in.OwnerID)...)
	}
	if len(tools) == 0 {
		return nil, capreg.ErrHidden
	}
	return &capreg.Binding{
		Tools: tools,
		State: capreg.CapabilityState{ID: capOpenapiAgentTools, Enabled: true},
	}, nil
}

// grantedOpTools —— the ops within one connector that this session has granted (op_<id> is
// in allowed_tools) → LLM tools.
func grantedOpTools(
	conn consumer.AgentToolConnector, granted map[string]bool, ownerID string,
) []capreg.BindingTool {
	var tools []capreg.BindingTool
	for _, op := range conn.AgentOps() {
		if granted[op.Name] {
			tools = append(tools, agentOpTool(conn, op, ownerID))
		}
	}
	return tools
}

// agentOpTool —— one op → one LLM tool. Run calls the SaaS with the LLM's args used verbatim
// as the request body and returns the raw response (the agent path: the LLM consumes the
// SaaS shape directly); on failure → a clean tool error (nothing about the underlying cause
// leaks), passed to the LLM by the agent loop.
func agentOpTool(
	conn consumer.AgentToolConnector, op consumer.AgentOp, ownerID string,
) capreg.BindingTool {
	opID := op.OpID
	run := func(ctx context.Context, argsJSON string) (string, error) {
		raw, cerr := conn.CallAgentOp(ctx, ownerID, opID, json.RawMessage(argsJSON))
		if cerr != nil {
			return "", errAgentOpFailed
		}
		return string(raw), nil
	}
	return capreg.NewTool(op.Name, op.Description, "", agentToolArgsSchema, run)
}

func grantedSet(names []string) map[string]bool {
	out := make(map[string]bool, len(names))
	for _, n := range names {
		out[n] = true
	}
	return out
}
