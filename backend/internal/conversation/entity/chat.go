// chat.go —— Chat aggregate root: all state + invariants for one visitor
// session. Dialog is a child entity (one Q-A round), Citation is a VO;
// this file holds only Chat itself.
//
// Replaces the earlier `Conversation` naming — frontend and backend now
// both say Chat. The table is still named `conversations` (a storage
// detail); the domain layer no longer leaks that name.

package entity

import (
	"errors"
	"time"
)

// ChatMode —— visitor session mode enum (replaces a bare string).
type ChatMode string

// ChatMode values: code/byoai/public.
const (
	ChatModeCode   ChatMode = "code"
	ChatModeBYOAI  ChatMode = "byoai"
	ChatModePublic ChatMode = "public"
)

// Chat —— visitor session aggregate root. The conversation never ends: a
// summary is just one artifact row in chat_reports (one per session), and
// the visitor can keep chatting; it doesn't attach to a conversations row.
//
// Invariants:
//   - Within one chat, Dialog.CreatedAt is monotonically increasing (caller's
//     responsibility)
//
// Field order follows govet fieldalignment: time.Time first, then pointer,
// string, numeric.
type Chat struct {
	StartedAt   time.Time
	LastAt      time.Time
	CodeID      *string
	MemberID    *string
	ID          string
	OwnerID     string
	VisitorName string
	Mode        ChatMode
}

// ErrChatNotFound —— chat doesn't exist / doesn't belong to the owner.
var ErrChatNotFound = errors.New("chat not found")
