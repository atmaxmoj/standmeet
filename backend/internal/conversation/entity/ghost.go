// conversation_ghost.go —— H.13.e: the domain for shown/accept logging of
// visitor input-box ghost text. The owner admin detail page uses this to
// see what was suggested each turn and whether the visitor accepted it.
//
// Source distinguishes the initial queue (KindInitial: sourced from
// access_codes.ghosts) from later follow-ups (KindFollowup: sourced from
// the SSE `ghosts` frame).
//
// AcceptedAt nil = the visitor saw it but didn't press Tab; non-nil = the
// moment (server now()) the visitor pressed Tab to accept.

package entity

import (
	"errors"
	"time"
)

// GhostSource —— where a ghost came from; persisted as a string.
type GhostSource string

const (
	// GhostInitial comes from the ghosts the owner filled in when
	// creating the code.
	GhostInitial GhostSource = "initial"
	// GhostFollowup comes from the inference.Generate sub-call at the end
	// of the backend's agent_turn (3 follow-ups appended after each AI
	// answer).
	GhostFollowup GhostSource = "followup"
)

// ErrInvalidGhostSource —— returned when the shown route receives an
// invalid source string.
var ErrInvalidGhostSource = errors.New("invalid ghost source")

// ErrGhostNotFound —— returned as 404 when the accept route can't find the
// ghost id (visitor passed a wrong one / row already deleted by cascade).
var ErrGhostNotFound = errors.New("ghost not found")

// Ghost —— one shown log entry. AcceptedAt later flips from nil to a real
// timestamp via the accept route.
type Ghost struct {
	ShownAt        time.Time
	AcceptedAt     *time.Time
	ID             string
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         GhostSource
	TurnIndex      int32
}

// Accepted —— whether the visitor pressed Tab to accept it (used by the
// admin UI).
func (s *Ghost) Accepted() bool {
	return s.AcceptedAt != nil
}

// GhostWaypointStat —— ghost-steering telemetry: the funnel for one
// waypoint (policy ghost shown vs accepted).
type GhostWaypointStat struct {
	TargetWaypoint string
	Shown          int64
	Accepted       int64
}

// AcceptanceRate —— accepted/shown, as a decimal (shown=0 → 0).
func (s *GhostWaypointStat) AcceptanceRate() float64 {
	if s.Shown == 0 {
		return 0
	}
	return float64(s.Accepted) / float64(s.Shown)
}

// ParseGhostSource —— route input validation; returns the sentinel error
// on an invalid value.
func ParseGhostSource(s string) (GhostSource, error) {
	switch GhostSource(s) {
	case GhostInitial, GhostFollowup:
		return GhostSource(s), nil
	}
	return "", ErrInvalidGhostSource
}
