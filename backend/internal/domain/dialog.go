// dialog.go —— Dialog: 一轮 Q-A 的 domain 概念。
// 一个 Dialog = visitor question + AI answer + AI 引用了哪些 corpus。
// 持久层落两条 messages 行 (role=visitor + role=assistant)，这是 mapper
// 关心的事；domain 层 Dialog 是一等的。
//
// 前端 `Turn` 是同一个概念的旧名 (D-5 pi-pivot 时取的，从 agent loop
// iteration 视角)。统一叫 Dialog。

package domain

import "time"

// Dialog —— 一轮 visitor 问 + AI 答 + cited。
//
// ID 字段暂时拿 assistant message 的 id 当 dialog 标识 (DB 暂时没单独
// dialog 表)。caller 想 ref 单轮时用这个。
type Dialog struct {
	CreatedAt time.Time
	ID        string
	ChatID    string
	Question  string
	Answer    string
	Citations []Citation
}

// NewDialog —— 构造 dialog (createdAt 用调用方传入的时间，便于测试 + 持
// 久层回灌)。
func NewDialog(chatID, question, answer string, cites []Citation, at time.Time) Dialog {
	return Dialog{
		ChatID: chatID, Question: question, Answer: answer,
		Citations: cites, CreatedAt: at,
	}
}
