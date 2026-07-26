// conversation_view.go —— 会话聚合读模型的 view 类型(从 visitor_history.go
// 拆出,守 max-public-structs)。概念三层 code → session → conversation。

package conversation

import "time"

// Conversation —— 对话聚合本体。count = len(Dialogs)(无 used 字段);只含答完的轮。
// 对话不结束(生成 summary 不封口);summary 是独立 chat_reports artifact,不挂这里。
type Conversation struct {
	StartedAt time.Time
	Dialogs   []ConvDialog
}

// ConvCode —— 这段会话所属 code 的配额视图(概念上属 code,不属 conversation)。
// MemberCount = 这张 code 下开了多少 session。
type ConvCode struct {
	MaxTurnsPerSession int32
	MaxMembers         int32
	MemberCount        int
}

// ConvSession —— 凭 token 找到的 session 视图:身份 + 所属 code + 该 member 已用
// turn 合计。UsedTurns 是 **member 级**(跨该人全部对话求和),前端 strip 据此显
// used —— 多对话模型下不能再让前端从单 surface 的本地 dialogs 数,会少算。
type ConvSession struct {
	VisitorName string
	Code        ConvCode
	UsedTurns   int32
}

// VisitorView —— 端点返回的整体:session(找到 conversation 的入口)+ 它的
// conversation。两个概念各占一块,不混。
type VisitorView struct {
	Conversation Conversation
	Session      ConvSession
}
