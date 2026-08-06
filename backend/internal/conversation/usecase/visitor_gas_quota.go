// visitor_gas_quota.go —— 发言前查一次油量(#7)。
//
// 跟隔壁 visitor_turn_quota.go 是同一个形状,只是量纲不同:轮数换成 token。
//
//   · 没挂表 → **一次查询都不发**就返回。这不是优化,是"绝大多数 owner 从不计量"那条路
//     必须在结构上跟今天一模一样 —— 挂表与否由 role 说了算,而它默认是 false。
//   · 挂了表 → 写之前查一次,空了就回一个哨兵,面翻成 403 + 一句人话。
//   · 剩多少不存计数器:owner 域读时从用量求和派生(那边的 provider_gas.go)。
//
// 最后那一轮可能超出一点点:闸门在写之前,用量在答完之后。这跟轮数配额是同一种取舍 ——
// 想不超一个 token,就得在答之前知道它要花多少,那是不可能的。

package usecase

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// GasQuotaInput —— 这一场的油表参数,发会话时就冻好了(跟 provider 一起)。
type GasQuotaInput struct {
	OwnerID    string
	ProviderID string
	// Metered —— 这一场挂没挂表(role 上的开关,冻在会话里)。
	Metered bool
}

// EnforceGasQuota —— 返 nil = 可以发;access.ErrGasExhausted = 这箱油空了。
func EnforceGasQuota(
	ctx context.Context, deps *VisitorSessionDeps, in *GasQuotaInput,
) error {
	if !gaugeIsOn(deps, in) {
		return nil
	}
	left, err := deps.Gas.Remaining(ctx, in.OwnerID, in.ProviderID)
	if err != nil {
		return fmt.Errorf("read gas: %w", err)
	}
	// nil = 这箱油没挂表。role 上的开关开着、油箱上没加过油,合起来仍然是"不计量":
	// 两个开关都得在,少一个就是今天这条路。
	if left == nil || *left > 0 {
		return nil
	}
	return access.ErrGasExhausted
}

// gaugeIsOn —— 这一场要不要查油量。三个都得成立,否则一次查询都不发。
func gaugeIsOn(deps *VisitorSessionDeps, in *GasQuotaInput) bool {
	return in.Metered && in.ProviderID != "" && deps.Gas != nil
}
