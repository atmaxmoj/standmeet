// conversation_view.go —— 会话聚合读模型的 view 类型(从 visitor_history.go
// 拆出,守 max-public-structs)。概念三层 code → session → conversation。

package usecases

import "time"

// Conversation —— 对话聚合本体。count = len(Dialogs)(无 used 字段);只含答完的轮。
type Conversation struct {
	StartedAt  time.Time
	EndedAt    *time.Time
	Dialogs    []ConvDialog
	Ended      bool
	HasSummary bool
}

// ConvCode —— 这段会话所属 code 的配额视图(概念上属 code,不属 conversation)。
// MemberCount = 这张 code 下开了多少 session。
type ConvCode struct {
	MaxTurnsPerSession int32
	MaxMembers         int32
	MemberCount        int
}

// ConvSession —— 凭 token 找到的 session 视图:身份 + 所属 code。
type ConvSession struct {
	VisitorName string
	Code        ConvCode
}

// VisitorView —— 端点返回的整体:session(找到 conversation 的入口)+ 它的
// conversation。两个概念各占一块,不混。
type VisitorView struct {
	Session      ConvSession
	Conversation Conversation
}
