// Package consumer —— 连接器轴的**消费者契约**:非连接器代码(内核的 openapi-agent-tools 装配面、
// owner 工具、admin 路由)依赖的连接器轴类型 —— agent-tool 连接器接口 + mail-未配错误。
//
// 放一个独立 leaf(不在 internal/connector 实现包里、也不在 contract 包里)有两个作用:
//   - 消费者不必 import 连接器**实现**包 → 杀掉 connector→usecases 那条反向依赖;
//   - 这里**没有** typed 品类 proxy(CalendarProxy 留在 contract),所以内核 import 它也够不到
//     品类面,#135 的"内核零 typed 品类面"锁不被削弱。
package consumer

import (
	"context"
	"encoding/json"
	"errors"
)

// ErrMailNotConfigured —— owner 还没配 / 没验通 mail 连接器,发不出信。
// sibling: contract.ErrCalendarNotConnected(日历那侧的同类哨兵)。
var ErrMailNotConfigured = errors.New("mail connector not configured")

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
