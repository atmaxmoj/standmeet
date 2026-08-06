// provider_gas.go —— 一箱油还剩多少。
//
// **没有计数器列。** 剩余 = 加了多少 − 自加油那一刻起记在这条 provider 上的计量用量。
// 跟 turn 配额同一个做法(那边 "turn 数不再存,读时从 messages 派生"):没有第二处状态,
// 也就没有"计数器跟事实对不上"这种 bug;加油只是把起算点往前挪,不需要清零任何东西。
//
// 用量表属于 stats 域,这个域不认识它 —— 所以这里只声明一个窄口(SpendReader),
// 组装根接上。同一份算术只有这一处:面板上的读数和挡住访客的那道闸走的是同一个函数。

package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// SpendReader —— 一条 provider 自某时刻起花掉的计量 token(stats 域实现)。
type SpendReader interface {
	SpentSince(ctx context.Context, providerID string, since time.Time) (int64, error)
}

// ProviderRemaining —— 这条 provider 还剩多少 token。nil = 这箱油没挂表(不计量)。
//
// 负数夹到 0:最后那一轮可以超一点点(闸门在写之前,用量在写之后),而"还剩 -37"
// 对任何读它的人都不是一句有用的话。
func ProviderRemaining(
	ctx context.Context, spend SpendReader, row *repo.ProviderRow,
) (*int64, error) {
	if row.GasTokens == nil || spend == nil {
		return nil, nil //nolint:nilnil // nil = 不计量,是这个域里的正常答案
	}
	spent, err := spend.SpentSince(ctx, row.ID, gasPeriodStart(row))
	if err != nil {
		return nil, fmt.Errorf("read provider spend: %w", err)
	}
	left := max(*row.GasTokens-spent, 0)
	return &left, nil
}

// gasPeriodStart —— 从哪一刻起算账。老行(加过油但没记时刻)退到零时:那时候整张表还没有
// 计量行,求和结果一样。
func gasPeriodStart(row *repo.ProviderRow) time.Time {
	if row.GasFilledAt == nil {
		return time.Time{}
	}
	return *row.GasFilledAt
}
