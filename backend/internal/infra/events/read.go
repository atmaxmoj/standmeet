// read.go — the event stream as the Tasks panel and events.list / events.get show it.

package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	defaultListLimit = 50
	maxListLimit     = 500
	// globOverfetch — a type glob is matched in Go, so List reads this many times the page.
	globOverfetch = 4
)

// Filter — for List. Empty fields match everything.
type Filter struct {
	Type    string // exact type or glob
	Subject string
	Limit   int
}

// Backlog — the relay's health.
type Backlog struct {
	OldestUnfannedAge time.Duration `json:"oldest_unfanned_age_ns"`
	Unfanned          int           `json:"unfanned"`
	Poisoned          int           `json:"poisoned"`
	TableBytes        int64         `json:"table_bytes"`
}

const eventCols = `id, seq, coalesce(owner_id::text, ''), type, subject, data, occurred_at,
	fanned_out_at, fanout, poisoned_at IS NOT NULL, last_error`

// Get — one event.
func (b *Bus) Get(ctx context.Context, id string) (Event, error) {
	e, err := scanEvent(b.pool.QueryRow(ctx,
		`SELECT `+eventCols+` FROM events WHERE id::text = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("get event: %w", err)
	}
	return e, nil
}

// List — newest first.
func (b *Bus) List(ctx context.Context, f Filter) ([]Event, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	limit = min(limit, maxListLimit)
	rows, err := b.pool.Query(ctx, `SELECT `+eventCols+` FROM events
		WHERE ($1 = '' OR subject = $1) ORDER BY seq DESC LIMIT $2`,
		f.Subject, limit*listOverfetch(f))
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()
	out, err := collectMatching(rows, f.Type, limit)
	if err != nil {
		return nil, err
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	return out, nil
}

// Backlog — unfanned and poisoned counts and the age of the oldest unfanned event.
func (b *Bus) Backlog(ctx context.Context) (Backlog, error) {
	var (
		bl     Backlog
		oldest *time.Time
	)
	if err := b.pool.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE fanned_out_at IS NULL AND poisoned_at IS NULL),
		count(*) FILTER (WHERE poisoned_at IS NOT NULL AND fanned_out_at IS NULL),
		min(occurred_at) FILTER (WHERE fanned_out_at IS NULL AND poisoned_at IS NULL),
		pg_total_relation_size('events')
		FROM events`).Scan(&bl.Unfanned, &bl.Poisoned, &oldest, &bl.TableBytes); err != nil {
		return bl, fmt.Errorf("event backlog: %w", err)
	}
	if oldest != nil {
		bl.OldestUnfannedAge = time.Since(*oldest)
	}
	return bl, nil
}

func scanEvent(row pgx.Row) (Event, error) {
	var (
		e      Event
		fanout []byte
	)
	if err := row.Scan(&e.ID, &e.Seq, &e.OwnerID, &e.Type, &e.Subject, &e.Data, &e.OccurredAt,
		&e.FannedOutAt, &fanout, &e.Poisoned, &e.LastError); err != nil {
		return Event{}, err //nolint:wrapcheck // callers wrap
	}
	e.Fanout = []Target{}
	_ = json.Unmarshal(fanout, &e.Fanout) //nolint:errcheck // written by fanOutRows only
	return e, nil
}

// collectMatching — up to limit rows whose type matches glob ("" matches every type).
func collectMatching(rows pgx.Rows, glob string, limit int) ([]Event, error) {
	out := []Event{}
	for rows.Next() && len(out) < limit {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		if typeMatches(glob, e.Type) {
			out = append(out, e)
		}
	}
	return out, nil
}

// typeMatches — whether a List filter's glob matches typ; "" matches every type.
func typeMatches(glob, typ string) bool { return glob == "" || Match(glob, typ) }

// listOverfetch — a type glob is matched in Go, so read a few more rows than the page.
func listOverfetch(f Filter) int {
	if f.Type == "" {
		return 1
	}
	return globOverfetch
}
