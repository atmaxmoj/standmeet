// inference_usage.go —— #106 计费:inference_usage 表访问。每次 owner-key LLM 调用 Record 一行,
// admin Summary 拿近 7 天按天×model 聚合,boot 时 Cleanup 清 >7 天老行。

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/stats/db"
	"github.com/atmaxmoj/standmeet/internal/stats/entity"
)

// InferenceUsageRepo —— inference_usage 表入口。
type InferenceUsageRepo struct {
	pool *pgstore.Pool
}

// NewInferenceUsageRepo —— DI 构造。
func NewInferenceUsageRepo(pool *pgstore.Pool) *InferenceUsageRepo {
	return &InferenceUsageRepo{pool: pool}
}

// UsageRow —— 一次 owner-key LLM 调用的用量。ProviderID 空 = 记不到某条 provider 上
// (旧会话 / 已删的那条);Metered = 这一趟算在那箱油的账上(#7)。
type UsageRow struct {
	OwnerID      string
	Model        string
	ProviderID   string
	InputTokens  int
	OutputTokens int
	CachedTokens int
	Metered      bool
}

// Record —— 记一次 owner-key LLM 调用的用量。
func (r *InferenceUsageRepo) Record(ctx context.Context, in *UsageRow) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	qerr := db.New(r.pool).RecordInferenceUsage(ctx, db.RecordInferenceUsageParams{
		OwnerID:      ownerUUID,
		Model:        in.Model,
		InputTokens:  int32(in.InputTokens),
		OutputTokens: int32(in.OutputTokens),
		CachedTokens: int32(in.CachedTokens),
		ProviderID:   pgstore.UUIDOrNull(in.ProviderID),
		Metered:      in.Metered,
	})
	if qerr != nil {
		return fmt.Errorf("record inference usage: %w", qerr)
	}
	return nil
}

// SpentSince —— 一条 provider 自某时刻起花掉的计量 token。**没有计数器列**:跟 turn 配额
// 一样读时求和,所以"加油"只是挪一下起算点,不需要清零任何东西。
func (r *InferenceUsageRepo) SpentSince(
	ctx context.Context, providerID string, since time.Time,
) (int64, error) {
	providerUUID, err := pgstore.ParseUUID(providerID)
	if err != nil {
		return 0, fmt.Errorf("parse provider id: %w", err)
	}
	sum, qerr := db.New(r.pool).SumMeteredUsageSince(ctx, db.SumMeteredUsageSinceParams{
		ProviderID: providerUUID,
		CreatedAt:  pgtype.Timestamptz{Time: since, Valid: true},
	})
	if qerr != nil {
		return 0, fmt.Errorf("sum metered usage: %w", qerr)
	}
	return sum, nil
}

// Summarize7Day —— 某 owner 近 7 天按天×model 聚合。
func (r *InferenceUsageRepo) Summarize7Day(
	ctx context.Context, ownerID string,
) ([]entity.InferenceUsageDay, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SummarizeInferenceUsage7Day(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("summarize inference usage: %w", qerr)
	}
	out := make([]entity.InferenceUsageDay, 0, len(rows))
	for i := range rows {
		out = append(out, entity.InferenceUsageDay{
			Day:          rows[i].Day.Time,
			Model:        rows[i].Model,
			Calls:        rows[i].Calls,
			InputTokens:  rows[i].InputTokens,
			OutputTokens: rows[i].OutputTokens,
		})
	}
	return out, nil
}

// Cleanup —— 删 >7 天的老行(boot 时调;查询本就只看 7 天,清理只为不让表无限涨)。
func (r *InferenceUsageRepo) Cleanup(ctx context.Context) error {
	if err := db.New(r.pool).DeleteInferenceUsageOlderThan7Days(ctx); err != nil {
		return fmt.Errorf("cleanup inference usage: %w", err)
	}
	return nil
}
