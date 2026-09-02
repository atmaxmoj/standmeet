// Package stats — domain value objects for the Monitor observability surface:
// activity feed, corpus growth, link-graph nodes, background jobs.
// All are read-only snapshots derived from existing rows (no separate event
// table), normalized for admin's Monitor / TopBar to consume.
// Its own domain module (#135 package-by-domain), no longer crammed into a
// domain god-package.

package entity

import "time"

// ActivityEvent — one derived activity event (ActivityTicker). Each is a
// {kind, at, label} tuple.
type ActivityEvent struct {
	At    time.Time
	Kind  string // 'visitor' | 'ingest'
	Label string
}

// GraphNode — one node in the corpus link graph: a note + its link degree
// (edges touching it in note_refs, counted both directions). Higher degree
// means more of a hub. Used by admin TopBar's constellation (nodes grow
// with more links).
type GraphNode struct {
	ID     string
	Title  string
	Genre  string
	Degree int
}
