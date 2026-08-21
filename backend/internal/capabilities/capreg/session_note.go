// session_note.go —— 会话**开始之后**才成立的事实，怎么到达模型。
//
// 访客那一场的 system prompt 是**发会话时定下、由浏览器拼好再发回来**的（`/sessions` 下发
// part id + persona，`AgentTurnRequest.System` 由客户端组好）。也就是说：任何在会话中途才变成
// 真的事情 —— 额度用完了、连接器掉线了、授权被收窄了 —— **没有一条路进得了那份提示**。
//
// F-B-14 就是这么发生的：额度用尽时宿主把订会能力藏了，第三轮的 agent 手上没有工具、提示里
// 却仍写着「你会订会」，而**没有一句话说明发生了什么**；它于是当着访客的面把两场真的会
// 说成「其实没订成」。产品先前修 F-B-10 时绕过了这个限制 —— 把事实塞进**工具结果**
// （`can_book`），因为工具结果是每次调用现算的。
//
// 这里给的是那条缺失的通路本身：能力可以为**这一场**说一句话，宿主每一轮把它拼进 instruction。
// 一句话由能力自己说（宿主不认识 booking），什么时候说也由它自己判（它才知道自己的闸）。

package capreg

import "context"

// SessionNoter —— 可选接口：这个能力对**这一场**有没有一句非说不可的话。
//
// 空 = 没有。它跟 SystemPromptFragment 的区别是时机：fragment 是会话开始时定下的静态说明书，
// note 是每一轮现问的、只属于这一场此刻的事实。
type SessionNoter interface {
	SessionNote(ctx context.Context, in *AssembleInput) string
}

// SessionNotes —— 这一场里各能力要说的话，按注册顺序。没有就是空切片（不是 nil）。
func (r *Registry) SessionNotes(ctx context.Context, in *AssembleInput) []string {
	out := make([]string, 0, 1)
	for _, c := range r.enabledCaps(ctx, in) {
		noter, ok := c.(SessionNoter)
		if !ok {
			continue
		}
		if note := noter.SessionNote(ctx, in); note != "" {
			out = append(out, note)
		}
	}
	return out
}
