// code_period.go —— 码级每周期速率闸的求值（embed 规划 2026-09-01）。
//
// 跟 gas 的关系：gas 是**总量**（花完手动续）；这个是**每周期自动回满**的桶。没有计数器列 ——
// 剩多少读时从 dialogs 求和派生（跟 gas / turn 配额同一个做法：没有第二处状态，就没有
// "计数器跟事实对不上"这种 bug）。窗口是**滚动式**：数这张码在过去 period_seconds 内的量。

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// turnsSince —— 这张码自某时刻起累计了多少轮（跨这张码的所有会话）。一个 dialog = 一轮。
func (r *CodeRepo) turnsSince(ctx context.Context, codeID string, since time.Time) (int64, error) {
	cid, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return 0, fmt.Errorf("parse code id: %w", err)
	}
	n, qerr := db.New(r.pool).CountCodeTurnsSince(ctx, db.CountCodeTurnsSinceParams{
		CodeID:    cid,
		CreatedAt: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if qerr != nil {
		return 0, fmt.Errorf("count code turns: %w", qerr)
	}
	return n, nil
}

// PeriodLimitExceeded —— 这张码这个周期的额度用完了没。
//
//   - 码没挂周期闸（limit_per_period IS NULL）→ false，一次查询都不发（跟今天同一条路）。
//   - 挂了 turns 闸 → 数过去 period_seconds 内的轮数，>= amount 即 true（该拒）。
//   - unit=='gas' 暂不在这里判（gas 走 provider gas 表，后续接）；unit 不认识 → 当作不限。
//
// 最后一轮可能超一点点：闸在写之前查，用量在答完之后落。跟 gas / turn 配额同一种取舍。
func (r *CodeRepo) PeriodLimitExceeded(ctx context.Context, codeID string) (bool, error) {
	code, err := r.GetByID(ctx, codeID)
	if err != nil {
		return false, err
	}
	w := code.LimitPerPeriod.TurnsCap()
	if w == nil {
		return false, nil
	}
	since := time.Now().Add(-time.Duration(w.PeriodSeconds) * time.Second)
	used, cerr := r.turnsSince(ctx, codeID, since)
	if cerr != nil {
		return false, cerr
	}
	return used >= w.Amount, nil
}

// CheckPeriodLimit —— turn preflight 用，返回一个可直接给 handleVisitorErr 的错误。
// 空 codeID（public/byoai 会话）→ nil。额度用完 → ErrPeriodLimitReached（上层翻 403）。
// 逻辑住在 repo：路由层圈复杂度上限 3，这里替它把"该不该拦"判完。
func (r *CodeRepo) CheckPeriodLimit(ctx context.Context, codeID string) error {
	if codeID == "" {
		return nil
	}
	over, err := r.PeriodLimitExceeded(ctx, codeID)
	if err != nil {
		return err
	}
	if over {
		return entity.ErrPeriodLimitReached
	}
	return nil
}
