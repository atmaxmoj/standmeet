// agent_tool_connector.go —— #155 §3 第二条 consumer 路（agent=语义读操作）的消费契约。
// openapi 连接器若开了 expose_as_agent_tools，把它的 raw operations 暴露成 per-session agent
// 工具（op_<operationId>）；LLM 按 operation 的 summary 自己选用，无品类契约、无 JSONata 映射。
// 消费者（per-session openapi-agent-tools capability）按名解析连接器后类型断言到本接口。

package usecases

import (
	"context"
	"encoding/json"
)

// AgentOp —— 一个 openapi operation 暴露成的 agent tool 的元数据。
type AgentOp struct {
	Name        string // op_<operationId>（点 → 下划线；D-3 snake_case）
	OpID        string // 原始 operationId（运行时按它调 SaaS）
	Description string // operation summary（缺则 description）—— 喂 LLM 选用
}

// AgentToolConnector —— 把自己的 raw operations 暴露成 agent 工具的连接器（目前只有 openapi）。
// 凭据/auth 注入全在连接器内（CallAgentOp 内部解密注入），消费者只递 ownerID + opID + args。
type AgentToolConnector interface {
	ExposesAgentTools() bool
	AgentOps() []AgentOp
	CallAgentOp(
		ctx context.Context, ownerID, opID string, argsJSON json.RawMessage,
	) (json.RawMessage, error)
}
