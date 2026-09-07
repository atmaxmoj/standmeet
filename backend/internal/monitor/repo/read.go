// read.go —— the owner-facing reads.
//
// The SQL is assembled here rather than generated because the filter set is decided per request
// (docs/design/monitor.md §5). Every value goes in as a bind parameter; no filter value is ever
// concatenated into the statement.

package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// EventsInputSchema —— what the events read accepts.
//
// The wire shapes for the two owner-facing reads live here, in the domain, because that is
// where a payload shape belongs: the convergence point aggregates operations, it does not own
// their schemas. Note what this file does NOT import to declare them — the parity vocabulary.
// Monitor is the domain that watches the others, so it stays free of everything it can;
// `encoding/json` says what a read takes and returns, and the convergence point supplies the
// rest.
var EventsInputSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"surface":{"type":"string",
			"description":"One surface only. Empty means all."},
		"event":{"type":"string",
			"description":"One event name. Empty matches views, which carry no name."},
		"window":{"type":"string","enum":["7d","28d","90d"],
			"description":"How far back to look. Default 28d; 90d is also the retention limit."},
		"entity_id":{"type":"string",
			"description":"Only events about this corpus entry, by its immutable id."},
		"include_bots":{"type":"boolean",
			"description":"Include crawler and link-preview traffic. Default false."},
		"limit":{"type":"integer","description":"Row cap. Default 100, max 1000."}
	}
}`)

// EventsArgs —— what a caller may narrow the feed by.
type EventsArgs struct {
	Surface string `json:"surface"`
	Event   string `json:"event"`
	// Window —— 7d / 28d / 90d. Anything else, empty included, means the default.
	Window      string `json:"window"`
	EntityID    string `json:"entity_id"`
	Limit       int    `json:"limit"`
	IncludeBots bool   `json:"include_bots"`
}

// EventsOut —— the feed's response. Events is never null: an empty array means "nothing
// recorded yet", while a null reads as "this is broken", and on a fresh instance a panel cannot
// tell those apart.
type EventsOut struct {
	Events []EventRow `json:"events"`
}

const (
	defaultEventLimit = 100
	maxEventLimit     = 1000
)

// EventsQueryFrom —— raw arguments become a bounded query.
//
// Decoding and bounding live here rather than at the convergence point: a face is meant to hold
// a declaration and a call, and every branch it grows is a piece of this domain's business that
// has moved out of reach of this domain's tests. Empty arguments are valid — no filter, default
// cap — so a caller asking for "everything recent" writes nothing at all.
func EventsQueryFrom(raw json.RawMessage, ownerID string) (EventQuery, error) {
	var in EventsArgs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return EventQuery{}, fmt.Errorf("invalid arguments: %w", err)
		}
	}
	return in.query(ownerID, time.Now().UTC()), nil
}

// query —— the args as a query, with the row cap bounded. One place decides the default and the
// ceiling, so a caller cannot ask for the whole table by passing a large number.
func (a *EventsArgs) query(ownerID string, now time.Time) EventQuery {
	limit := a.Limit
	if limit <= 0 {
		limit = defaultEventLimit
	}
	if limit > maxEventLimit {
		limit = maxEventLimit
	}
	return EventQuery{
		Since:   WindowSince(a.Window, now),
		OwnerID: ownerID, Limit: limit, Surface: a.Surface,
		EventName: a.Event, EntityID: a.EntityID, IncludeBots: a.IncludeBots,
	}
}

// EventQuery —— which events the owner asked for.
type EventQuery struct {
	// Since —— the window's lower bound. Never zero: a query with no bound would read the whole
	// table, and the number it produced would silently disagree with every number beside it.
	Since       time.Time
	OwnerID     string
	Surface     string
	EventName   string
	EntityID    string
	Limit       int
	IncludeBots bool
}

// EventRow —— one event as the panel reads it.
type EventRow struct {
	Props       map[string]string `json:"props"`
	CreatedAt   time.Time         `json:"created_at"`
	EventID     string            `json:"event_id"`
	ViewerID    string            `json:"viewer_id"`
	VisitID     string            `json:"visit_id"`
	Surface     string            `json:"surface"`
	EventName   string            `json:"event_name"`
	URLPath     string            `json:"url_path"`
	PageTitle   string            `json:"page_title"`
	RefDomain   string            `json:"referrer_domain"`
	EntityKind  string            `json:"entity_kind"`
	EntityID    string            `json:"entity_id"`
	EntityTitle string            `json:"entity_title"`
	CodeID      string            `json:"code_id"`
	CodeLabel   string            `json:"code_label"`
	Browser     string            `json:"browser"`
	OS          string            `json:"os"`
	Device      string            `json:"device"`
	Country     string            `json:"country"`
	Src         string            `json:"src"`
	BotName     string            `json:"bot_name"`
	IsBot       bool              `json:"is_bot"`
}

const eventSelect = `
SELECT event_id, coalesce(viewer_id,''), visit_id, created_at, surface, event_name, is_bot,
       url_path, page_title, referrer_domain, src,
       entity_kind, entity_id, entity_title,
       coalesce(code_id::text,''), code_label,
       browser, os, device, country, props
FROM visit_event`

// Events —— the raw feed, newest first.
func (r *Repo) Events(ctx context.Context, q *EventQuery) ([]EventRow, error) {
	owner, perr := pgstore.ParseUUID(q.OwnerID)
	if perr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, perr)
	}
	where, args := eventFilters(q, owner)
	sql := eventSelect + " WHERE " + strings.Join(where, " AND ") +
		" ORDER BY created_at DESC LIMIT " + strconv.Itoa(q.Limit)
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query visit events: %w", err)
	}
	defer rows.Close()
	return collectEvents(rows)
}

// collectEvents —— drains the cursor. Split out so Events stays within the branch budget; the
// row error check after the loop is not optional, because a cursor that fails midway otherwise
// returns a short list that reads exactly like "there were only two rows".
func collectEvents(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
},
) ([]EventRow, error) {
	out := []EventRow{}
	for rows.Next() {
		row, serr := scanEvent(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, row)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate visit events: %w", rerr)
	}
	return out, nil
}

// eventFilters —— the WHERE clauses and their bind values. Bots are excluded unless asked for,
// which is the default every number on the panel is computed under.
func eventFilters(q *EventQuery, owner pgtype.UUID) ([]string, []any) {
	where := []string{"owner_id = $1", "created_at >= $2"}
	args := []any{owner, q.Since}
	if !q.IncludeBots {
		where = append(where, "NOT is_bot")
	}
	for _, f := range []struct{ col, val string }{
		{"surface", q.Surface},
		{"event_name", q.EventName},
		{"entity_id", q.EntityID},
	} {
		if f.val == "" {
			continue
		}
		args = append(args, f.val)
		where = append(where, f.col+" = $"+strconv.Itoa(len(args)))
	}
	return where, args
}

// rowScanner —— just enough of pgx.Rows to keep scanEvent testable and short.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanEvent(rows rowScanner) (EventRow, error) {
	var e EventRow
	var props []byte
	err := rows.Scan(
		&e.EventID, &e.ViewerID, &e.VisitID, &e.CreatedAt, &e.Surface, &e.EventName, &e.IsBot,
		&e.URLPath, &e.PageTitle, &e.RefDomain, &e.Src,
		&e.EntityKind, &e.EntityID, &e.EntityTitle,
		&e.CodeID, &e.CodeLabel,
		&e.Browser, &e.OS, &e.Device, &e.Country, &props,
	)
	if err != nil {
		return EventRow{}, fmt.Errorf("scan visit event: %w", err)
	}
	e.Props = decodeProps(props)
	e.BotName = e.Props["bot"]
	return e, nil
}

// decodeProps —— never nil. A null map serialises to JSON null, and a panel cannot tell that
// from a broken column.
func decodeProps(raw []byte) map[string]string {
	out := map[string]string{}
	if len(raw) == 0 {
		return out
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]string{}
	}
	return out
}

// Summary —— the numbers at the top of the panel.
//
// Viewers, visits and views are three different counts, and the two-level identity is what
// makes them different: without it, "views per person" cannot tell a reader who came back six
// times from one who scrolled six pages once (monitor.md §1.1).
type Summary struct {
	Viewers int64 `json:"viewers"`
	Visits  int64 `json:"visits"`
	Views   int64 `json:"views"`
	Events  int64 `json:"events"`
	Bots    int64 `json:"bots"`
}

const summarySQL = `
SELECT count(DISTINCT viewer_id) FILTER (WHERE NOT is_bot),
       count(DISTINCT visit_id)  FILTER (WHERE NOT is_bot),
       count(*) FILTER (WHERE NOT is_bot AND event_name = ''),
       count(*) FILTER (WHERE NOT is_bot),
       count(*) FILTER (WHERE is_bot)
FROM visit_event
WHERE owner_id = $1 AND created_at >= $2`

// Stats —— the summary over one window. Bots are counted separately and never mixed into the
// other four.
//
// `since` is a parameter, not a default inside the query: the five numbers and the feed beside
// them must be counted over the same span, and the only way to guarantee that is for one
// caller to decide the span once and hand it to both.
func (r *Repo) Stats(ctx context.Context, ownerID string, since time.Time) (Summary, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return Summary{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	var s Summary
	serr := r.pool.QueryRow(ctx, summarySQL, owner, since).
		Scan(&s.Viewers, &s.Visits, &s.Views, &s.Events, &s.Bots)
	if serr != nil {
		return Summary{}, fmt.Errorf("query monitor summary: %w", serr)
	}
	return s, nil
}
