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

// 错误/变量（实现:entity）.
var (
	ErrChatNotFound       = entity.ErrChatNotFound
	ErrGhostNotFound      = entity.ErrGhostNotFound
	ErrInvalidGhostSource = entity.ErrInvalidGhostSource
	ErrReportNotFound     = entity.ErrReportNotFound
)
