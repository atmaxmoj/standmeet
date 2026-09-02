// stats_activity.go — data source for the recent activity feed (ActivityTicker). Its own
// domain: derives the most recent N events via a UNION over existing rows (visitor joins
// in code_members / corpus writes in corpus_notes), newest first.
// Raw pgx (same sqlc-bypass precedent as stats_growth) — not worth adding an aggregate
// query to the shared dbq for this.
//
// #135: booking events used to come from code_bookings, but booking has fully moved to
// booker's isolated capstore (code_bookings is retired). The activity layer shouldn't
// couple back to booker's capstore schema — so the booking branch is dropped here for now
// (it was already 0 rows against the now-empty code_bookings, so behavior is unchanged).
// Restoring booking events in the feed belongs to an injected booking-activity source
// (assembly root wired to capstore) — that's a separate feature pass.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/stats/entity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ActivityRepo — recent activity feed.
type ActivityRepo struct {
	pool *pgstore.Pool
}

// NewActivityRepo — constructor.
func NewActivityRepo(pool *pgstore.Pool) *ActivityRepo { return &ActivityRepo{pool: pool} }

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

// RecentActivity — owner-scoped, most recent `limit` events, newest first.
func (r *ActivityRepo) RecentActivity(
	ctx context.Context, ownerID string, limit int,
) ([]entity.ActivityEvent, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
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

// graphQuery — each note + its link degree (count of note_refs edges touching it, as src
// or dst). Top N by degree descending (the most hub-like notes). LEFT JOIN lets a note
// with 0 links still score degree 0.
const graphQuery = `
	SELECT n.id, n.title, n.genre, count(r.src_id) AS degree
	FROM corpus_notes n
	LEFT JOIN note_refs r ON (r.src_id = n.id OR r.dst_id = n.id) AND r.owner_id = $1
	WHERE n.owner_id = $1
	GROUP BY n.id, n.title, n.genre
	ORDER BY degree DESC, n.title ASC
	LIMIT $2`

// CorpusGraph — the owner's corpus link graph, top `limit` hub nodes (degree descending).
func (r *ActivityRepo) CorpusGraph(
	ctx context.Context, ownerID string, limit int,
) ([]entity.GraphNode, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
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

func scanGraphNodes(rows pgx.Rows) ([]entity.GraphNode, error) {
	nodes := make([]entity.GraphNode, 0)
	for rows.Next() {
		var id pgtype.UUID
		var title, genre string
		var degree int64
		if serr := rows.Scan(&id, &title, &genre, &degree); serr != nil {
			return nil, fmt.Errorf("scan graph node: %w", serr)
		}
		nodes = append(nodes, entity.GraphNode{
			ID: pgstore.FormatUUID(id), Title: title, Genre: genre, Degree: int(degree),
		})
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate graph nodes: %w", rerr)
	}
	return nodes, nil
}

func scanActivityEvents(rows pgx.Rows) ([]entity.ActivityEvent, error) {
	events := make([]entity.ActivityEvent, 0)
	for rows.Next() {
		var kind, label string
		var at pgtype.Timestamptz
		if serr := rows.Scan(&kind, &at, &label); serr != nil {
			return nil, fmt.Errorf("scan activity event: %w", serr)
		}
		events = append(events, entity.ActivityEvent{At: at.Time, Kind: kind, Label: label})
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate activity events: %w", rerr)
	}
	return events, nil
}
