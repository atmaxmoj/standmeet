package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/entity"

// Types (impl: entity).
type (
	AppStateRef       = entity.AppStateRef
	Chat              = entity.Chat
	ChatReport        = entity.ChatReport
	Ghost             = entity.Ghost
	GhostWaypointStat = entity.GhostWaypointStat
	Message           = entity.Message
)

// Functions (impl: entity).
var (
	// VisitorToolCalls -- the subset of a turn's tool_calls that may be sent down to the
	// visitor (F-A-28).
	VisitorToolCalls = entity.VisitorToolCalls
	// VisitorToolResult -- same rule on the live-stream path: retrieval results are never
	// sent to the visitor.
	VisitorToolResult = entity.VisitorToolResult
)

// Errors/vars (impl: entity).
var (
	ErrChatNotFound       = entity.ErrChatNotFound
	ErrGhostNotFound      = entity.ErrGhostNotFound
	ErrInvalidGhostSource = entity.ErrInvalidGhostSource
	ErrReportNotFound     = entity.ErrReportNotFound
)
