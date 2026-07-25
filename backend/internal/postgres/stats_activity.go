// stats_activity.go —— 近期活动流（ActivityTicker）的数据源。自成 domain：从现有行 UNION
// 派生最近 N 条事件（访客加入 code_members / corpus 写入 corpus_notes），最新在前。
// 裸 pgx（同 stats_growth 的 sqlc-bypass 先例）——不值当往共享 dbq 加聚合查询。
//
// #135: 预约事件曾来自 code_bookings,但 booking 已 100% 落 booker 的隔离 capstore(code_bookings
// 已废)。activity 层不该反向耦合 booker 的 capstore schema —— 所以这里先摘掉 booking 分支
// (它对空的 code_bookings 本就 0 行,行为不变)。要在 feed 里恢复 booking 事件,走注入式
// booking-activity 源(组装根接 capstore),是独立的 feature pass。

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

// graphQuery —— 每条 note + 它的链接度（note_refs 里 src 或 dst 触到它的边数）。degree
// 降序取前 N（最 hub 的 note）。LEFT JOIN 让 0 链接的 note 也计为 degree 0。
const graphQuery = `
	SELECT n.id, n.title, n.genre, count(r.src_id) AS degree
	FROM corpus_notes n
	LEFT JOIN note_refs r ON (r.src_id = n.id OR r.dst_id = n.id) AND r.owner_id = $1
	WHERE n.owner_id = $1
	GROUP BY n.id, n.title, n.genre
	ORDER BY degree DESC, n.title ASC
	LIMIT $2`

// CorpusGraph —— owner 的语料链接图前 limit 个 hub 节点（degree 降序）。
func (r *ActivityRepo) CorpusGraph(
	ctx context.Context, ownerID string, limit int,
) ([]domain.GraphNode, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("parse owner id: %w", err)
	}
	rows, err := r.pool.Query(ctx, graphQuery, ownerUUID, limit)
	if err != nil {
		return nil, fmt.Errorf("corpus graph: %w", err)
	}
	defer rows.Close()
	return scanGraphNodes(rows)
}

func scanGraphNodes(rows pgx.Rows) ([]domain.GraphNode, error) {
	nodes := make([]domain.GraphNode, 0)
	for rows.Next() {
		var id pgtype.UUID
		var title, genre string
		var degree int64
		if serr := rows.Scan(&id, &title, &genre, &degree); serr != nil {
			return nil, fmt.Errorf("scan graph node: %w", serr)
		}
		nodes = append(nodes, domain.GraphNode{
			ID: formatUUID(id), Title: title, Genre: genre, Degree: int(degree),
		})
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate graph nodes: %w", rerr)
	}
	return nodes, nil
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
