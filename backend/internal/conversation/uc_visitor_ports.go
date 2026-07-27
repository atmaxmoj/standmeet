// uc_visitor_ports.go —— visitor agent-loop 消费的 capability-assembly 窄口(consumer-side)。
// 结构上由 capreg glue 的具体实现满足;composition root 注入。跟 usecases/capreg_* 里的同名
// 口是结构对偶,conversation 因此不反依赖 capreg glue。

package conversation

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
)

// AgentConnectorSource —— 取 owner 的 agent-tool connector 列表(openapi capability 装配用)。
type AgentConnectorSource interface {
	AgentConnectors(ctx context.Context, ownerID string) ([]consumer.AgentToolConnector, error)
}

// DepConnected —— 命名 connector 依赖是否全连通(ext-mcp dep-grant 闸)。
type DepConnected interface {
	AllConnected(ctx context.Context, ownerID string, deps []string) (bool, error)
}
