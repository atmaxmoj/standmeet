// chat.go —— Chat aggregate root：一次 visitor session 的全部状态 +
// 不变式。Dialog 是子 entity (一轮 Q-A)，Citation 是 VO；这里只放 Chat
// 本身。
//
// 取代之前的 `Conversation` 命名 —— 前后端统一叫 Chat。table 名仍叫
// `conversations` (落地细节)；domain 层不再透出来。

package domain

import (
	"errors"
	"time"
)

// ChatMode —— visitor session mode 枚举 (取代裸 string)。
type ChatMode string

// ChatMode 取值：code/byoai/public。
const (
	ChatModeCode   ChatMode = "code"
	ChatModeBYOAI  ChatMode = "byoai"
	ChatModePublic ChatMode = "public"
)

// Chat —— visitor session aggregate root。
//
// 不变式：
//   - EndedAt 非 nil 时不能再 append dialog (CanAppendDialog 返 false)
//   - 同一 chat 内 Dialog.CreatedAt 单调递增 (caller 责任)
//
// 字段顺序按 govet fieldalignment：time.Time 在前、pointer、string、数值。
type Chat struct {
	StartedAt     time.Time
	LastAt        time.Time
	EndedAt       *time.Time
	CodeID        *string
	MemberID      *string
	BYOAIProvider *string
	ID            string
	OwnerID       string
	VisitorName   string
	SummaryMD     string
	Mode          ChatMode
	MessageCount  int32
}

// IsEnded —— 这个 chat 是否已经 /summary 关闭。EndedAt 非 nil 即视为 ended。
func (c *Chat) IsEnded() bool { return c.EndedAt != nil }

// CanAppendDialog —— 现在能不能再写一轮 dialog 进去。ended 之后不能。
func (c *Chat) CanAppendDialog() bool { return !c.IsEnded() }

// ErrChatNotFound —— chat 不存在 / 不属于 owner。
var ErrChatNotFound = errors.New("chat not found")

// ErrChatEnded —— visitor 在 /summary 之后再发消息 / 再 append dialog 触发。
var ErrChatEnded = errors.New("chat has ended")
