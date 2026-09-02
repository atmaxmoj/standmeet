// visitor_ports.go —— visitor agent-loop 消费的 capability-assembly 窄口(consumer-side)。
// 结构上由 capreg glue 的具体实现满足;composition root 注入。跟 usecases/capreg_* 里的同名
// 口是结构对偶,conversation 因此不反依赖 capreg glue。

package usecase

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

// ResumeSource —— 按 session 的 access code 取"这一份" application 的简历内容(JSON)。
// err != nil = 取不到(没绑 application 的普通码，或真失败)；访客侧简历读取 capability
// 一律据此 fail-closed 隐藏 —— 它不必分辨"没有"和"坏了"。装配用。
type ResumeSource interface {
	ResumeForCode(ctx context.Context, ownerID, codeID string) ([]byte, error)
}
