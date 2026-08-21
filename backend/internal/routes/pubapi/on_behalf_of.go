// on_behalf_of.go —— 「这一趟调用代表谁」。
//
// 访客那条路上这件事由身份弹窗回答:名字和邮箱是**访客自己填的**,而不是模型从对话里挑的 ——
// F-B-6 就是让模型挑的时候,它编出一个从没被说过的地址,聊天里还宣称已经发过去了。所以邀请人
// 只能来自会话身份,`calendar_book` 不收这个 tool arg。
//
// key 这条路上没有弹窗:调用方是别人的程序。**缺的正是那一格** —— 于是经 facade 订的每一场会
// 都是零参会人,而 owner 到点了对着空房间(F-B-12)。补法不是给工具加参数(那会把 F-B-6 重新打开),
// 是让调用方在**请求这一层**说明它代表谁,插件那一侧一个字都不用改。
//
// 不给就是不给:没有这两个头 = 一场只属于 owner 自己的 hold,回执里 `invited_email` 是空串,
// 说得清清楚楚。给了但不像个地址 → 400,不静悄悄地当没给 —— 「我以为我请了人」和「产品知道
// 我没请」之间差的正是这一句。

package pubapi

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
)

const (
	// headerVisitorEmail —— 代谁而约:这场会的客人。
	headerVisitorEmail = "X-Standmeet-Visitor-Email"
	// headerVisitorName —— 那个人的名字(可选,只进日历标题那类展示位)。
	headerVisitorName = "X-Standmeet-Visitor-Name"
	// maxVisitorNameLen —— 名字进的是日历事件标题,给它一个上限,免得一次调用把标题撑成一篇文章。
	maxVisitorNameLen = 120
)

var errBadVisitorEmail = errors.New(
	"X-Standmeet-Visitor-Email must be an email address — omit the header to book without a guest")

// visitorHeader —— 头上读出来的那两格。**本地类型,不 import 域**:面不许直连域的 facade
// (check-routes-via-dispatcher),而这一步本来也只是解析 HTTP,折成域的身份是调用方的事。
type visitorHeader struct {
	Name  string
	Email string
}

// onBehalfOf —— 从请求头读出这一趟代表谁。两个头都没有 → 空身份(合法)。
func onBehalfOf(r *http.Request) (visitorHeader, error) {
	email := strings.TrimSpace(r.Header.Get(headerVisitorEmail))
	name := strings.TrimSpace(r.Header.Get(headerVisitorName))
	if email == "" {
		return visitorHeader{Name: truncateName(name)}, nil
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return visitorHeader{}, errBadVisitorEmail
	}
	return visitorHeader{Name: truncateName(name), Email: email}, nil
}

func truncateName(name string) string {
	if len(name) <= maxVisitorNameLen {
		return name
	}
	return name[:maxVisitorNameLen]
}
