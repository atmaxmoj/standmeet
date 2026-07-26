// chat_report.go —— I.3: visitor chat 末尾 (或中途) 调
// summarize_conversation tool 生成的 HTML 报告。每次调存一份新行 (允许
// 同 conversation 多次重生)；conversation 不 mark ended，对话可继续。

package conversation

import (
	"errors"
	"time"
)

// ErrReportNotFound —— GET /report/{id} 查不到 (id 错 / cascade 删了)
// 返 404。
var ErrReportNotFound = errors.New("chat report not found")

// ChatReport —— 一份 HTML 报告 row。HTML 是 AI 直接输出的完整 body；
// 前端 sandboxed iframe 渲染。
type ChatReport struct {
	CreatedAt      time.Time
	ID             string
	OwnerID        string
	ConversationID string
	HTML           string
}
