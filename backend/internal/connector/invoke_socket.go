// invoke_socket.go —— connector.invoke host op：断网沙箱 cap 经 socket 按名调 owner 的 active
// 连接器(calendar/mail 等)的一个 verb。按业务分类:它跟连接器层住一起,不进机制 bucket。
// capsocket 只是那根传输;cmd 按每个 cap 挂它允许的 op(要连接器的 cap 才挂这个)。

package connector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
)

// Invoker —— 按名调用连接器(category+verb+args→json)。connector.Slots 满足它。
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
