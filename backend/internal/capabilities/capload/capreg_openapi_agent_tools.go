// capreg_openapi_agent_tools.go —— #155 §3 第二条 consumer 路：openapi 连接器的 raw operations
// 暴露成 per-session agent 工具（op_<operationId>）。一个 capreg.Capability，VisitorBinding 枚举
// owner 已 connected + expose_as_agent_tools 的 openapi 连接器，把每个 operation 变成一个 LLM
// tool（描述取 operation summary）；运行时按 op 调 SaaS、注入 auth、回原始响应（无契约、无映射）。
//
// 闸（跟其它 cap 同一张）：(a) 连接器 connected（source 已过滤）；(b) 该 op 的 tool 名在本
// session 的 allowed_tools 里（per-op grant）。纯品类绑定（无 expose）的连接器不进 source →
// 不泄 raw ops（[A5]）。

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

// errAgentOpFailed —— agent-tool 运行失败的干净 tool 错（不泄底层 SaaS/auth 细节给 LLM）。
var errAgentOpFailed = errors.New("the operation could not be completed")

// agentToolArgsSchema —— 宽松 object 入参（agent 路无契约；LLM 按 operation 自由构造 body）。
var agentToolArgsSchema = json.RawMessage(`{"type":"object"}`)

// AgentConnectorSource —— owner 的、connected 且 expose_as_agent_tools 的 openapi 连接器。
// composition root 适配 ConnectorRepo.ListByOwner + Hub（type-assert AgentToolConnector）。
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

// VisitorBinding —— 枚举 owner 的 agent 连接器 → 每个被授的 op 一个 tool。无可暴露 → ErrHidden。
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

// grantedOpTools —— 一个连接器里被本 session 授权的 op（op_<id> 在 allowed_tools）→ LLM tools。
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

// agentOpTool —— 一个 op → 一个 LLM tool。Run 把 LLM args 原样作请求体调 SaaS，回原始响应（agent
// 路：LLM 直接消费 SaaS 形状）；失败 → 干净 tool 错（不泄底层），由 agent loop 转给 LLM。
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
