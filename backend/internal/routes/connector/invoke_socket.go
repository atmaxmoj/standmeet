// Package connector —— "connector.invoke" 的 controller。断网沙箱 cap 经 unix-socket 按名(category)
// 调 owner 的 active 连接器的一个 verb。这是 **socket 入站 API 的 controller 层**(跟 internal/routes/
// 的 HTTP controller 同层):薄壳 —— 只解 socket 参数 + 转发进 connector 业务域(Invoker,由业务域的
// connector.Slots 结构满足)。业务逻辑留在 internal/connector,不进这里。组装根按每个需要连接器的 cap 挂它。
package connector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
)

// Invoker —— 按名调用连接器(category+verb+args→json)。业务域 connector.Slots 满足它。
type Invoker interface {
	Invoke(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// RegisterInvokeOp —— 把 "connector.invoke" 挂到 srv:{owner_id,category,verb,args} → Invoke。
func RegisterInvokeOp(srv *capsocket.Server, inv Invoker) {
	srv.Handle("connector.invoke", func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		var req struct {
			OwnerID  string          `json:"owner_id"`
			Category string          `json:"category"`
			Verb     string          `json:"verb"`
			Args     json.RawMessage `json:"args"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("connector.invoke: decode: %w", err)
		}
		out, err := inv.Invoke(ctx, req.OwnerID, req.Category, req.Verb, req.Args)
		if err != nil {
			return nil, fmt.Errorf("connector.invoke: %w", err)
		}
		return out, nil
	})
}
