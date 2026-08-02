// Package capconfig —— socket 入站 controller:沙箱里的能力问 host 要**自己的配置**。
//
// 为什么要一个专门的 op,而不是让沙箱自己 capstore.query 那份文档:**默认值在声明里**
// (manifest 的 ConfigField.Default),而声明在 host。沙箱自己查存储,owner 没设过就什么都读不到,
// 于是它只能自己再写一份默认值 —— 那正是要消灭的第二份副本。
//
// 所以这个 op 回的是**已经兜好底的最终值**:声明 ∪ owner 覆盖。沙箱拿到就用,不需要知道
// 哪些是默认、哪些是改过的。
//
// 跟 capstore 一样,构造期就绑死到某个 cap 的命名空间 —— 沙箱填不了别人的 id。
package capconfig

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// BoundConfig —— 已绑定到某个 cap 的配置读口(无 kind/id/声明:构造期就定死)。
type BoundConfig interface {
	Values(ctx context.Context, ownerID string) (map[string]json.RawMessage, error)
}

// Ops —— capconfig.get。只读:owner 改配置走面板,不走沙箱。
//
// 有这条,沙箱才不用自己再写一份默认值 —— 声明的默认值宿主已经兜好了。
//
// cfg 为 nil(这个能力没声明配置)→ 不开。给不出东西的来源自己说"没有"。
func Ops(cfg BoundConfig) []hostop.Op {
	if cfg == nil {
		return []hostop.Op{}
	}
	return []hostop.Op{{
		Name:        "capconfig.get",
		Description: "Read your own declared settings (values in effect, defaults filled in).",
		Invoke:      getHandler(cfg),
	}}
}

type getReq struct {
	OwnerID string `json:"owner_id"`
}

func getHandler(cfg BoundConfig) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req getReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capconfig.get: decode: %w", err)
		}
		values, err := cfg.Values(ctx, req.OwnerID)
		if err != nil {
			return nil, fmt.Errorf("capconfig.get: %w", err)
		}
		out, merr := json.Marshal(values)
		if merr != nil {
			return nil, fmt.Errorf("capconfig.get: marshal: %w", merr)
		}
		return out, nil
	}
}
