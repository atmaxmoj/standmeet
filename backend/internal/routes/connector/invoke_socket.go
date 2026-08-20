// Package connector —— "connector.invoke" 的 controller。断网沙箱 cap 经 unix-socket 按名(category)
// 调 owner 的 active 连接器的一个 verb。这是 **socket 入站 API 的 controller 层**(跟 internal/routes/
// 的 HTTP controller 同层):薄壳 —— 只解 socket 参数 + 转发进 connector 业务域(Invoker,由业务域的
// connector.Slots 结构满足)。业务逻辑留在 internal/connector,不进这里。组装根按每个需要连接器的 cap 挂它。
package connector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// Invoker —— 按名调用连接器(category+verb+args→json)。业务域 connector.Slots 满足它。
//
// InvokeBackground —— 立刻返回、调用在后台跑并按策略重试。给"结果不该挡住调用方"的调用用
// (约成后的 owner 通知信)。**必须由 host 持有**:沙箱能力的进程只活这一轮,起在它里面的
// 重试 goroutine 会随进程回收一起消失。
type Invoker interface {
	Invoke(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	) (json.RawMessage, error)
	InvokeBackground(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	)
}

// Ops —— connector.invoke。能力说"替我用日历做这件事",宿主找 owner 当前激活的那个连接器
// 去做 —— 能力不认识具体连接器,凭据也不出宿主。
//
// background=true → 不等结果直接回 {ok:true},调用在宿主后台跑(带重试)。
func Ops(inv Invoker) []hostop.Op {
	return []hostop.Op{{
		Name: "connector.invoke",
		Description: "Ask the owner's active connector for a category to do one verb. " +
			"The capability names a category, never a connector; credentials stay host-side.",
		Invoke: invokeHandler(inv),
	}}
}

func invokeHandler(inv Invoker) hostop.Invoke {
	return func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		var req struct {
			OwnerID    string          `json:"owner_id"`
			Category   string          `json:"category"`
			Verb       string          `json:"verb"`
			Args       json.RawMessage `json:"args"`
			Background bool            `json:"background"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("connector.invoke: decode: %w", err)
		}
		if req.Background {
			inv.InvokeBackground(ctx, req.OwnerID, req.Category, req.Verb, req.Args)
			return json.RawMessage(`{"ok":true,"background":true}`), nil
		}
		out, err := inv.Invoke(ctx, req.OwnerID, req.Category, req.Verb, req.Args)
		if err != nil {
			// Name the owner/category/verb: "not configured" is meaningless without knowing WHICH
			// owner was asked about — a stale or wrong owner id looks identical to a missing
			// connector from here.
			// `%w` 包住的是**业务域已经分好类的**那个错误（`hostop.Fault`）——
			// 类别因此穿得过这一层，一路到 socket 信封上的 `code`。
			// 分类不在这里做：这个薄壳按设计不认识连接器域的任何哨兵
			// （`connectorroutes: mayDependOn: [hostop]`），要在这儿判就得把域拖进来。
			return nil, fmt.Errorf("connector.invoke %s/%s owner=%s: %w",
				req.Category, req.Verb, req.OwnerID, err)
		}
		return out, nil
	}
}
