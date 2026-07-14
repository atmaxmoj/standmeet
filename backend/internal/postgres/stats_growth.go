// stats_growth.go —— corpus 增长脉搏（SystemPulse）的数据源。自成 domain：只读聚合，
// 走裸 pgx（跟 calendar_bookings 一样的 sqlc-bypass 先例）—— 一个 date_trunc GROUP BY
// 不值当往共享 dbq 加查询。三层 raw/wiki/output 各有 owner_id + created_at。

package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// corpusGrowthDays —— SystemPulse 序列窗口（今天往前数 14 天）。
const corpusGrowthDays = 14

// corpusDeltaDays —— 「近增量」窗口（末 7 天）。
const corpusDeltaDays = 7

// GrowthRepo —— corpus 增长统计。
type GrowthRepo struct {
	pool *Pool
}

// NewGrowthRepo 构造。
func NewGrowthRepo(pool *Pool) *GrowthRepo { return &GrowthRepo{pool: pool} }

// CorpusGrowth —— 分层总量 + 14 天新增序列 + 7 天增量。owner-scoped。
func (r *GrowthRepo) CorpusGrowth(
	ctx context.Context, ownerID string,
) (domain.CorpusGrowth, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.CorpusGrowth{}, fmt.Errorf("parse owner id: %w", err)
	}
	var tiers domain.CorpusTierCounts
	err = r.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM corpus_notes WHERE owner_id = $1 AND genre = 'raw'),
		  (SELECT count(*) FROM corpus_notes WHERE owner_id = $1 AND genre = 'wiki'),
		  (SELECT count(*) FROM corpus_notes WHERE owner_id = $1 AND genre = 'output'),
		  (SELECT count(*) FROM corpus_notes WHERE owner_id = $1 AND genre = 'writing'),
		  (SELECT count(*) FROM corpus_notes
		     WHERE owner_id = $1 AND genre = 'raw' AND promoted_to IS NULL AND NOT archived)`,
		ownerUUID).Scan(
		&tiers.Raw, &tiers.Wiki, &tiers.Output, &tiers.Writing, &tiers.RawUnprocessed,
	)
	if err != nil {
		return domain.CorpusGrowth{}, fmt.Errorf("count corpus tiers: %w", err)
	}
	byDay, err := r.corpusByDay(ctx, ownerUUID)
	if err != nil {
		return domain.CorpusGrowth{}, err
	}
	return assembleCorpusGrowth(tiers, byDay), nil
}

// corpusByDay —— 近 14 天每天(UTC)的三层合计新增，返 day→count（缺的天不出现）。
func (r *GrowthRepo) corpusByDay(
	ctx context.Context, ownerUUID pgtype.UUID,
) (map[string]int, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)
		FROM (
		  SELECT created_at, owner_id FROM corpus_notes WHERE genre = 'raw'
		  UNION ALL SELECT created_at, owner_id FROM corpus_notes WHERE genre = 'wiki'
		  UNION ALL SELECT created_at, owner_id FROM corpus_notes WHERE genre = 'output'
		) e
		WHERE e.owner_id = $1 AND e.created_at >= now() - interval '13 days'
		GROUP BY day`, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("corpus by day: %w", err)
	}
	defer rows.Close()
	byDay := make(map[string]int)
	for rows.Next() {
		var day string
		var count int
		if serr := rows.Scan(&day, &count); serr != nil {
			return nil, fmt.Errorf("scan day count: %w", serr)
		}
		byDay[day] = count
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate day counts: %w", rerr)
	}
	return byDay, nil
}

// assembleCorpusGrowth —— 铺满 14 天序列（缺天补 0）、算 7 天增量、组装分层总量。
func assembleCorpusGrowth(tiers domain.CorpusTierCounts, byDay map[string]int) domain.CorpusGrowth {
	now := time.Now().UTC()
	series := make([]domain.CorpusDayCount, corpusGrowthDays)
	delta7 := 0
	for i := range corpusGrowthDays {
		day := now.AddDate(0, 0, i-(corpusGrowthDays-1)).Format("2006-01-02")
		count := byDay[day]
		series[i] = domain.CorpusDayCount{Day: day, Count: count}
		if i >= corpusGrowthDays-corpusDeltaDays {
			delta7 += count
		}
	}
	return domain.CorpusGrowth{
		Series:  series,
		ByTier:  tiers,
		Total:   tiers.Raw + tiers.Wiki + tiers.Output,
		Delta7d: delta7,
	}
}
