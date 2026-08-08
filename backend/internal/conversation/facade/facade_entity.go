package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/entity"

// 类型（实现:entity）.
type (
	AppStateRef       = entity.AppStateRef
	Chat              = entity.Chat
	ChatReport        = entity.ChatReport
	Ghost             = entity.Ghost
	GhostWaypointStat = entity.GhostWaypointStat
	Message           = entity.Message
)

// 函数（实现:entity）.
var (
	// VisitorToolCalls —— 一轮的 tool_calls 里可以下发给访客的那一份(F-A-28)。
	VisitorToolCalls = entity.VisitorToolCalls
	// VisitorToolResult —— 直播那一路的同一条规则:检索结果不发给访客。
	VisitorToolResult = entity.VisitorToolResult
)

// 错误/变量（实现:entity）.
var (
	ErrChatNotFound       = entity.ErrChatNotFound
	ErrGhostNotFound      = entity.ErrGhostNotFound
	ErrInvalidGhostSource = entity.ErrInvalidGhostSource
	ErrReportNotFound     = entity.ErrReportNotFound
)
