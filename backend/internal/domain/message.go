// message.go —— Message：messages 表的一行 row。一个 Dialog 落 2 条
// (visitor + assistant)。
//
// Message 是持久层细节，但又不能彻底封到 postgres package：admin
// transcript 接口对外仍按 "messages 数组" 暴露 (老 frontend 形态 + 兼容
// 旧 SSE)。所以放在 domain 但留作内部 row 类型，prefer Dialog 作为 domain
// 第一公民。

package domain

import "time"

// Message —— conversation 内一条消息 row。ToolCalls 是 assistant 那条本轮跑过的
// tool 调用(opaque jsonb,前端 [{name,ok,result}] 原样存取),属于这段对话的
// 一部分:owner 回看 / visitor 续看都要看见 AI search 了啥、read 了哪篇。
type Message struct {
	CreatedAt            time.Time
	ID                   string
	ConversationID       string
	Role                 string // 'visitor' | 'assistant'
	Body                 string
	CitedWikiIDs         []string
	CitedWritingIDs      []string
	CitedOutputIDs       []string
	CitedSubjectivityIDs []string
	ToolCalls            []byte
}
