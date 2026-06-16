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

// Chat —— visitor session aggregate root。对话不结束：summary 只是 chat_reports
// 表里的一份 artifact(一会话一份),访客可继续聊;不挂 conversations 行。
//
// 不变式：
//   - 同一 chat 内 Dialog.CreatedAt 单调递增 (caller 责任)
//
// 字段顺序按 govet fieldalignment：time.Time 在前、pointer、string、数值。
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

// ErrChatNotFound —— chat 不存在 / 不属于 owner。
var ErrChatNotFound = errors.New("chat not found")
