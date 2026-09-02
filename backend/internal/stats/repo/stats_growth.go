// stats_growth.go — data source for the corpus growth pulse (SystemPulse). Its own
// domain: read-only aggregates, raw pgx (same sqlc-bypass precedent as calendar_bookings)
// — a single date_trunc GROUP BY isn't worth adding to the shared dbq. The three tiers
// raw/wiki/output each carry owner_id + created_at.

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/stats/entity"
	"github.com/jackc/pgx/v5/pgtype"
)

// corpusGrowthDays — SystemPulse series window (14 days back from today).
const corpusGrowthDays = 14

// corpusDeltaDays — the "recent delta" window (last 7 days).
const corpusDeltaDays = 7

// GrowthRepo — corpus growth statistics.
type GrowthRepo struct {
	pool *pgstore.Pool
}

// NewGrowthRepo — constructor.
func NewGrowthRepo(pool *pgstore.Pool) *GrowthRepo { return &GrowthRepo{pool: pool} }

// CorpusGrowth — per-tier totals + 14-day new-note series + 7-day delta. Owner-scoped.
func (r *GrowthRepo) CorpusGrowth(
	ctx context.Context, ownerID string,
) (entity.CorpusGrowth, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.CorpusGrowth{}, fmt.Errorf("parse owner id: %w", err)
	}
	var tiers entity.CorpusTierCounts
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
		return entity.CorpusGrowth{}, fmt.Errorf("count corpus tiers: %w", err)
	}
	byDay, err := r.corpusByDay(ctx, ownerUUID)
	if err != nil {
		return entity.CorpusGrowth{}, err
	}
	return assembleCorpusGrowth(tiers, byDay), nil
}

// corpusByDay — combined new-note count across the three tiers per day (UTC) for the
// last 14 days; returns day→count (missing days are absent).
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

// assembleCorpusGrowth — fills out the 14-day series (zero-fill missing days), computes
// the 7-day delta, and assembles the per-tier totals.
func assembleCorpusGrowth(tiers entity.CorpusTierCounts, byDay map[string]int) entity.CorpusGrowth {
	now := time.Now().UTC()
	series := make([]entity.CorpusDayCount, corpusGrowthDays)
	delta7 := 0
	for i := range corpusGrowthDays {
		day := now.AddDate(0, 0, i-(corpusGrowthDays-1)).Format("2006-01-02")
		count := byDay[day]
		series[i] = entity.CorpusDayCount{Day: day, Count: count}
		if i >= corpusGrowthDays-corpusDeltaDays {
			delta7 += count
		}
	}
	return entity.CorpusGrowth{
		Series:  series,
		ByTier:  tiers,
		Total:   tiers.Raw + tiers.Wiki + tiers.Output,
		Delta7d: delta7,
	}
}
