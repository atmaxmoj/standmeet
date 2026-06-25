// hub.go —— 消费者无关的命名连接器注册表（connector 重构 · 接缝）。
//
// 动机（为什么有这层，且为什么它必须中性、绝不 import MCP）：
//
// connector 是「持凭据的底座」—— 凭据解密、OAuth 刷新、重试全在连接器内部。**谁来用它
// 不该被写死成 MCP。** 今天的消费者是访客 chat 的 MCP 能力（经 capreg 的依赖解析 gate
// 后调 proxy），但 connector 本身不该知道这件事。
//
// 将来的消费者可能完全不是 MCP。比如一个 **IM Gateway**：owner 在 Discord / Slack 里被
// @，Gateway（将来）唤起 agent；agent 用该 IM 连接器的凭据 **消费 channel 历史**（read）
// 进上下文，再用同一凭据 **发消息**（write）回 channel。整条路径不碰 MCP / 访客 session /
// mcp-ui:tool —— 它只是「另一个消费者」。
//
// 所以「按名解析一个连接器 + 拿它的调用句柄」这件事必须住在**中性位置**，任何消费者都能
// 用，且**不 import capreg（MCP 包）**。capreg 的 enabledCaps gate 只是其中一个消费者，
// 实现阶段应当把 capreg.DepRegistry 并进本 Hub（一个底座、多个消费者，别各搭一套）。
//
// 凭据永不出 connector：Hub 解析回的是「句柄」（Connector 基面 + 各连接器自己的能力接口），
// 没有任何凭据 getter；read 和 write 都在连接器内部用解密后的凭据完成。
package connector

import "context"

// Connector —— 所有连接器的基面：一个名字 + 能答「这个 owner 连没连」。具体能力（日历的
// InsertEvent、IM 的 ReadChannel/Send、SMTP 的 Send …）由各连接器**自己的接口**给；消费者
// 按名解析到 Connector 后，按需类型断言到它要的能力接口。基面上**没有凭据 getter**。
type Connector interface {
	Name() string
	Connected(ctx context.Context, ownerID string) (bool, error)
}

// Hub —— 消费者无关的命名连接器注册表。任何消费者（MCP 能力 gate、IM Gateway、未来的任务
// 编排）都按名解析，拿句柄、调用；凭据 / OAuth / 重试全在连接器内，消费者不感知。
type Hub struct {
	conns map[string]Connector
}

// NewHub —— 空注册表。
func NewHub() *Hub { return &Hub{conns: map[string]Connector{}} }

// Register —— 注册一个命名连接器。重名 panic（boot 期失败比运行时撞名好）。
func (h *Hub) Register(c Connector) {
	name := c.Name()
	if _, dup := h.conns[name]; dup {
		panic("connector: duplicate connector " + name)
	}
	h.conns[name] = c
}

// Resolve —— 按名取连接器；未注册 → (nil, false)。
func (h *Hub) Resolve(name string) (Connector, bool) {
	c, ok := h.conns[name]
	return c, ok
}
