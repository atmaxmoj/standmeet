// conversation.go —— visitor chat session + 单条 message + session 可见
// corpus 范围（由 access code 派生，挂在这里因为它是 session-level concern）。

package domain

import (
	"errors"
	"time"
)

// Conversation —— 一次 visitor chat 会话。
//
// EndedAt + SummaryMD: A2 /summary 路径写。ended 之后 visitor 不能再发
// 消息（POST /messages 返 410 ErrConversationEnded）。SummaryMD 是 AI
// 生成的 markdown，visitor 客户端拿去渲染 PDF / 分享给老板。
type Conversation struct {
	StartedAt     time.Time
	LastAt        time.Time
	EndedAt       *time.Time
	CodeID        *string
	MemberID      *string
	BYOAIProvider *string
	ID            string
	OwnerID       string
	Mode          string // 'code' | 'byoai' | 'public' — session mode
	VisitorName   string
	SummaryMD     string
	MessageCount  int32
}

// Message —— conversation 内一条消息。
type Message struct {
	CreatedAt      time.Time
	ID             string
	ConversationID string
	Role           string // 'visitor' | 'assistant'
	Body           string
	CitedWikiIDs   []string
	CitedOutputIDs []string
}

// ErrConversationNotFound —— conversation 不存在。
var ErrConversationNotFound = errors.New("conversation not found")

// ErrConversationEnded —— visitor 在 /summary 后再发消息触发。
var ErrConversationEnded = errors.New("conversation has ended")
