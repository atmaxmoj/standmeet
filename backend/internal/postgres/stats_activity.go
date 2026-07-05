// stats_activity.go —— 近期活动流（ActivityTicker）的数据源。自成 domain：从现有行 UNION
// 派生最近 N 条事件（访客加入 code_members / corpus 写入 corpus_notes / 预约 code_bookings），
// 最新在前。裸 pgx（同 stats_growth 的 sqlc-bypass 先例）——不值当往共享 dbq 加聚合查询。

package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// ActivityRepo —— 近期活动流。
type ActivityRepo struct {
	pool *Pool
}

// NewActivityRepo 构造。
func NewActivityRepo(pool *Pool) *ActivityRepo { return &ActivityRepo{pool: pool} }

const activityQuery = `
	SELECT kind, at, label FROM (
	  SELECT 'visitor'::text AS kind, c.started_at AS at,
	         COALESCE(m.display_name, 'visitor') AS label
	    FROM conversations c
	    LEFT JOIN code_members m ON m.id = c.member_id
	    WHERE c.owner_id = $1
	  UNION ALL
	  SELECT 'ingest', created_at, title FROM corpus_notes WHERE owner_id = $1 AND genre = 'wiki'
	  UNION ALL
	  SELECT 'booking', created_at, COALESCE(NULLIF(summary, ''), 'meeting booked')
	    FROM code_bookings WHERE owner_id = $1
	) e
	ORDER BY at DESC
	LIMIT $2`

// RecentActivity —— owner-scoped 最近 limit 条事件，最新在前。
func (r *ActivityRepo) RecentActivity(
	ctx context.Context, ownerID string, limit int,
) ([]domain.ActivityEvent, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("parse owner id: %w", err)
	}
	rows, err := r.pool.Query(ctx, activityQuery, ownerUUID, limit)
	if err != nil {
		return nil, fmt.Errorf("recent activity: %w", err)
	}
	defer rows.Close()
	return scanActivityEvents(rows)
}

func scanActivityEvents(rows pgx.Rows) ([]domain.ActivityEvent, error) {
	events := make([]domain.ActivityEvent, 0)
	for rows.Next() {
		var kind, label string
		var at pgtype.Timestamptz
		if serr := rows.Scan(&kind, &at, &label); serr != nil {
			return nil, fmt.Errorf("scan activity event: %w", serr)
		}
		events = append(events, domain.ActivityEvent{At: at.Time, Kind: kind, Label: label})
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate activity events: %w", rerr)
	}
	return events, nil
}
