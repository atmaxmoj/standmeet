// conversation.go —— visitor chat session + 单条 message + session 可见
// corpus 范围（由 access code 派生，挂在这里因为它是 session-level concern）。

package domain

import (
	"errors"
	"time"
)

// Conversation —— 一次 visitor chat 会话。
type Conversation struct {
	StartedAt     time.Time
	LastAt        time.Time
	CodeID        *string
	MemberID      *string
	BYOAIProvider *string
	ID            string
	OwnerID       string
	Tier          string // 'code' | 'byoai' | 'public'
	VisitorName   string
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
