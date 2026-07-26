// inference_usage.go —— #106 计费:inference_usage 表访问。每次 owner-key LLM 调用 Record 一行,
// admin Summary 拿近 7 天按天×model 聚合,boot 时 Cleanup 清 >7 天老行。

package postgres

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
	"github.com/atmaxmoj/standmeet/internal/stats"
)

// InferenceUsageRepo —— inference_usage 表入口。
type InferenceUsageRepo struct {
	pool *Pool
}

// NewInferenceUsageRepo —— DI 构造。
func NewInferenceUsageRepo(pool *Pool) *InferenceUsageRepo {
	return &InferenceUsageRepo{pool: pool}
}

// Record —— 记一次 owner-key LLM 调用的用量。
func (r *InferenceUsageRepo) Record(
	ctx context.Context, ownerID, model string, inputTokens, outputTokens int,
) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	qerr := dbq.New(r.pool).RecordInferenceUsage(ctx, dbq.RecordInferenceUsageParams{
		OwnerID:      ownerUUID,
		Model:        model,
		InputTokens:  int32(inputTokens),
		OutputTokens: int32(outputTokens),
	})
	if qerr != nil {
		return fmt.Errorf("record inference usage: %w", qerr)
	}
	return nil
}

// Summarize7Day —— 某 owner 近 7 天按天×model 聚合。
func (r *InferenceUsageRepo) Summarize7Day(
	ctx context.Context, ownerID string,
) ([]stats.InferenceUsageDay, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).SummarizeInferenceUsage7Day(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("summarize inference usage: %w", qerr)
	}
	out := make([]stats.InferenceUsageDay, 0, len(rows))
	for i := range rows {
		out = append(out, stats.InferenceUsageDay{
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
	if err := dbq.New(r.pool).DeleteInferenceUsageOlderThan7Days(ctx); err != nil {
		return fmt.Errorf("cleanup inference usage: %w", err)
	}
	return nil
}
