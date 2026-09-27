// sessions.go —— the per-viewer breakdown behind the summary numbers. The summary says "12
// viewers"; this says WHICH twelve and what each did. Kept in its own file so read.go stays under
// the public-struct budget, and because "sessions" is a distinct read from the feed + the totals.

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SessionRow —— one viewer, aggregated. viewer_id is a monthly-salted hash, never an identity
// (monitor.md §1.1). The geo/device fields are the most recent non-empty value the viewer
// presented, so a person who moved networks reads as where they last were, not blank. (Field order
// groups the pointer-carrying fields first, for alignment.)
type SessionRow struct {
	LastSeen time.Time `json:"last_seen"`
	ViewerID string    `json:"viewer_id"`
	Country  string    `json:"country"`
	Region   string    `json:"region"`
	City     string    `json:"city"`
	Browser  string    `json:"browser"`
	OS       string    `json:"os"`
	Device   string    `json:"device"`
	BotName  string    `json:"bot_name"`
	Visits   int64     `json:"visits"`
	Views    int64     `json:"views"`
	IsBot    bool      `json:"is_bot"`
}

// latestNonEmpty —— the most recent non-empty value of a column across a viewer's events. A viewer
// spans many rows; the newest one that actually carried the fact is the truthful answer.
func latestNonEmpty(col string) string {
	return "coalesce((array_agg(" + col + " ORDER BY created_at DESC) FILTER (WHERE " + col +
		" <> ''))[1], '')"
}

var sessionsSQL = `
SELECT coalesce(viewer_id,'')                    AS viewer_id,
       count(DISTINCT visit_id)                  AS visits,
       count(*) FILTER (WHERE event_name = '')   AS views,
       max(created_at)                           AS last_seen,
       ` + latestNonEmpty("country") + ` AS country,
       ` + latestNonEmpty("region") + ` AS region,
       ` + latestNonEmpty("city") + ` AS city,
       ` + latestNonEmpty("browser") + ` AS browser,
       ` + latestNonEmpty("os") + ` AS os,
       ` + latestNonEmpty("device") + ` AS device,
       ` + latestNonEmpty("props->>'bot'") + ` AS bot_name,
       bool_or(is_bot)                           AS is_bot
FROM visit_event
WHERE owner_id = $1 AND created_at >= $2
GROUP BY viewer_id
HAVING $4::timestamptz IS NULL
    OR (max(created_at), coalesce(viewer_id,'')) < ($4::timestamptz, $5::text)
ORDER BY last_seen DESC, viewer_id DESC
LIMIT $3`

// Sessions —— one page of the per-viewer breakdown over one window, newest-seen first
// (docs/design/paging.md). Bots are included and flagged, the same as the feed: "Googlebot, 40
// views" is real information an owner acts on, and hiding it would make the human rows
// unverifiable against the summary.
func (r *Repo) Sessions(
	ctx context.Context, ownerID string, since time.Time, req paging.Request,
) (paging.Page[SessionRow], error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return paging.Page[SessionRow]{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	afterAt, afterID := sessionCursor(req.After)
	rows, qerr := r.pool.Query(ctx, sessionsSQL, owner, since, req.Fetch(), afterAt, afterID)
	if qerr != nil {
		return paging.Page[SessionRow]{}, fmt.Errorf("query monitor sessions: %w", qerr)
	}
	defer rows.Close()
	out, err := collectSessions(rows)
	if err != nil {
		return paging.Page[SessionRow]{}, err
	}
	return paging.Cut(out, req, func(s *SessionRow) paging.Cursor {
		return paging.Cursor{At: s.LastSeen, ID: s.ViewerID}
	}), nil
}

// sessionCursor —— the keyset params: NULL for the first page. viewer_id is a hash, not a uuid,
// and a viewer-less row (the IM bridge) groups under ”; the cursor carries it as text.
func sessionCursor(after *paging.Cursor) (pgtype.Timestamptz, *string) {
	if after == nil {
		return pgtype.Timestamptz{}, nil
	}
	return pgtype.Timestamptz{Time: after.At, Valid: true}, &after.ID
}

// collectSessions —— drains the cursor. Split out so Sessions stays within the complexity budget;
// the post-loop error check is not optional (a cursor failing midway otherwise returns a short list
// that reads exactly like "there were only two viewers").
func collectSessions(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
},
) ([]SessionRow, error) {
	out := []SessionRow{}
	for rows.Next() {
		var s SessionRow
		if e := rows.Scan(&s.ViewerID, &s.Visits, &s.Views, &s.LastSeen,
			&s.Country, &s.Region, &s.City, &s.Browser, &s.OS, &s.Device,
			&s.BotName, &s.IsBot); e != nil {
			return nil, fmt.Errorf("scan session row: %w", e)
		}
		out = append(out, s)
	}
	if e := rows.Err(); e != nil {
		return nil, fmt.Errorf("session rows: %w", e)
	}
	return out, nil
}
