// cited.go —— retrieval-style capability 的 cited 协议。emitDoneEvent
// 在 stream 结束时调 Binding.Cited (若非 nil) 拿真读过的 corpus entries，
// build cited footer 写进 messages.cited_*_ids。
//
// 仅 corpus.retrieval 实现；其他 capability (booker / ext-mcp / skill) 不
// 贡献 cited，Binding.Cited 留 nil。

package agentskills

import "github.com/atmaxmoj/standmeet/internal/domain"

// CitedSnapshot —— retrieval-style capability 在 streamReply 结束时回报
// "visitor 真读过的 corpus entry"。
type CitedSnapshot struct {
	Wikis   []domain.Wiki
	Outputs []domain.Output
}
