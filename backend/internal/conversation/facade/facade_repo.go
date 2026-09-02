package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/repo"

// Types (impl: repo).
type (
	AppStateRepo      = repo.AppStateRepo
	ChatRepo          = repo.ChatRepo
	ChatReportRepo    = repo.ChatReportRepo
	ChatSummary       = repo.ChatSummary
	ChatWithMessages  = repo.ChatWithMessages
	GhostRepo         = repo.GhostRepo
	UpsertReportInput = repo.UpsertReportInput
)

// Constructors/functions (impl: repo).
var (
	NewAppStateRepo   = repo.NewAppStateRepo
	NewChatRepo       = repo.NewChatRepo
	NewChatReportRepo = repo.NewChatReportRepo
	NewGhostRepo      = repo.NewGhostRepo
)
