package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/repo"

// 类型（实现:repo）.
type (
	AppStateRepo      = repo.AppStateRepo
	ChatRepo          = repo.ChatRepo
	ChatReportRepo    = repo.ChatReportRepo
	ChatSummary       = repo.ChatSummary
	ChatWithMessages  = repo.ChatWithMessages
	GhostRepo         = repo.GhostRepo
	UpsertReportInput = repo.UpsertReportInput
)

// 构造/函数（实现:repo）.
var (
	NewAppStateRepo   = repo.NewAppStateRepo
	NewChatRepo       = repo.NewChatRepo
	NewChatReportRepo = repo.NewChatReportRepo
	NewGhostRepo      = repo.NewGhostRepo
)
