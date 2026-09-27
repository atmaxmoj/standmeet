// Package paging — the one keyset paginator every owner list uses (docs/design/paging.md).
//
// Order is newest first on (at, id). A cursor is opaque to clients: base64url of
// "at(RFC3339Nano)|id". A list fetches limit+1 rows; Cut keeps limit of them and turns
// the extra row into "there is a next page".
package paging

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"
	"time"
)

// Page-size bounds shared by every list.
const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// ErrBadCursor — the cursor did not come from this server. Callers answer bad input,
// never "first page": a silently restarted list repeats rows the owner already saw.
var ErrBadCursor = errors.New("bad cursor")

// Cursor — the last row of the previous page.
type Cursor struct {
	At time.Time
	ID string
}

// Encode — the opaque form handed to clients.
func (c Cursor) Encode() string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(c.At.UTC().Format(time.RFC3339Nano) + "|" + c.ID),
	)
}

// Decode — "" is the first page (nil cursor).
func Decode(s string) (*Cursor, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty cursor = first page, not an error
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, ErrBadCursor
	}
	return parse(string(raw))
}

// parse — the decoded "at|id" form.
func parse(raw string) (*Cursor, error) {
	ts, id, ok := strings.Cut(raw, "|")
	if !ok || id == "" {
		return nil, ErrBadCursor
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return nil, ErrBadCursor
	}
	return &Cursor{At: t, ID: id}, nil
}

// Request — a decoded page request. Fetch is the row count to ask the store for (Limit+1).
type Request struct {
	After *Cursor
	Limit int32
}

// Fetch — how many rows the query asks for: one more than the page, to learn if more exist.
func (r Request) Fetch() int32 { return r.Limit + 1 }

// Args — the wire args every paged op accepts next to its own filters.
type Args struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

// Parse — decode the cursor and clamp the limit (0 = DefaultLimit).
func (a *Args) Parse() (Request, error) {
	after, err := Decode(a.Cursor)
	if err != nil {
		return Request{}, err
	}
	return Request{After: after, Limit: clamp(a.Limit)}, nil
}

// clamp — 0 or less is the default; above MaxLimit is MaxLimit.
func clamp(n int) int32 {
	if n <= 0 {
		return DefaultLimit
	}
	return int32(min(n, MaxLimit))
}

// argProps — the JSON-schema properties of Args, added to every paged op's input schema.
var argProps = map[string]json.RawMessage{
	"cursor": json.RawMessage(`{"type":"string",` +
		`"description":"next_cursor from the previous page; omit for the first page."}`),
	"limit": json.RawMessage(`{"type":"integer","description":"Page size (default 50, max 200)."}`),
}

// Schema — a list op's input schema with cursor and limit added. filters is the op's own
// {"type":"object","properties":{…}} (nil = no filters). A malformed filters schema panics
// at startup: every op schema is a literal, and a bad one would empty tools/list.
func Schema(filters json.RawMessage) json.RawMessage {
	s := struct {
		Properties map[string]json.RawMessage `json:"properties"`
		Type       string                     `json:"type"`
		Required   []string                   `json:"required,omitempty"`
	}{Type: "object"}
	if filters != nil {
		if err := json.Unmarshal(filters, &s); err != nil {
			panic("paging.Schema: " + err.Error())
		}
	}
	if s.Properties == nil {
		s.Properties = map[string]json.RawMessage{}
	}
	maps.Copy(s.Properties, argProps)
	out, err := json.Marshal(s)
	if err != nil {
		panic("paging.Schema: " + err.Error())
	}
	return out
}

// Parsed — a paged op's decoded args: its own filters, and the page request.
type Parsed[F any] struct {
	Filter F
	Req    Request
}

// ParseArgs — a paged op's raw args: its own filters F (any other keys ignored), and the page
// request (cursor, limit). Empty args are no filters and the first page.
func ParseArgs[F any](raw json.RawMessage) (Parsed[F], error) {
	var out Parsed[F]
	var a Args
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out.Filter); err != nil {
			return out, fmt.Errorf("list args: %w", err)
		}
		if err := json.Unmarshal(raw, &a); err != nil {
			return out, fmt.Errorf("page args: %w", err)
		}
	}
	req, err := a.Parse()
	out.Req = req
	return out, err
}

// Page — the envelope every paged list returns, on REST and MCP alike. Total, when the list
// reports it, is how many rows match the filter across every page (never the loaded count).
type Page[T any] struct {
	Total      *int32 `json:"total,omitempty"`
	NextCursor string `json:"next_cursor,omitempty"`
	Items      []T    `json:"items"`
}

// WithTotal — the page, reporting how many rows match across every page.
func (p Page[T]) WithTotal(n int32) Page[T] {
	p.Total = &n
	return p
}

// Cut — trim a Fetch()-sized result to the page; the last kept row becomes the cursor.
func Cut[T any](rows []T, req Request, key func(*T) Cursor) Page[T] {
	if rows == nil {
		rows = []T{}
	}
	if int32(len(rows)) <= req.Limit {
		return Page[T]{Items: rows}
	}
	rows = rows[:req.Limit]
	return Page[T]{Items: rows, NextCursor: key(&rows[len(rows)-1]).Encode()}
}

// Map — convert a page's items, keeping its cursor.
func Map[T, U any](p Page[T], f func(*T) (U, error)) (Page[U], error) {
	out := make([]U, 0, len(p.Items))
	for i := range p.Items {
		u, err := f(&p.Items[i])
		if err != nil {
			return Page[U]{}, err
		}
		out = append(out, u)
	}
	return Page[U]{Items: out, NextCursor: p.NextCursor, Total: p.Total}, nil
}

// Each — Map for a conversion that cannot fail.
func Each[T, U any](p Page[T], f func(*T) U) Page[U] {
	out := make([]U, 0, len(p.Items))
	for i := range p.Items {
		out = append(out, f(&p.Items[i]))
	}
	return Page[U]{Items: out, NextCursor: p.NextCursor, Total: p.Total}
}
