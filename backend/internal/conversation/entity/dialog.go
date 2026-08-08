// dialog.go —— Dialog: 一轮 Q-A 的 domain 概念。
// 一个 Dialog = visitor question + AI answer + AI 引用了哪些 corpus。
// 持久层落两条 messages 行 (role=visitor + role=assistant)，这是 mapper
// 关心的事；domain 层 Dialog 是一等的。
//
// 前端 `Turn` 是同一个概念的旧名 (D-5 pi-pivot 时取的，从 agent loop
// iteration 视角)。统一叫 Dialog。

package entity

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
	// GroundedSubjectivityIDs —— 本轮读到、但没 opt-in 的 subjectivity 笔记 id。塑造了声音,
	// 不进访客 footer,落 owner 那一列(F-A-27)。跟 Citations 分开:访客那条路只看 Citations。
	GroundedSubjectivityIDs []string
	ToolCalls               []byte
}

// DialogInit —— NewDialog 入参(打包避开 argument-limit)。
type DialogInit struct {
	CreatedAt time.Time
	ChatID    string
	Question  string
	Answer    string
	Citations []Citation
	// GroundedSubjectivityIDs —— 本轮读到、但没 opt-in 的 subjectivity 笔记 id。塑造了声音,
	// 不进访客 footer,落 owner 那一列(F-A-27)。跟 Citations 分开:访客那条路只看 Citations。
	GroundedSubjectivityIDs []string
	ToolCalls               []byte
}

// NewDialog —— 构造 dialog (createdAt 用调用方传入的时间，便于测试 + 持
// 久层回灌)。ToolCalls 是 assistant 本轮跑过的 tool 调用(opaque jsonb)。
func NewDialog(in *DialogInit) Dialog {
	return Dialog{
		ChatID: in.ChatID, Question: in.Question, Answer: in.Answer,
		Citations:               in.Citations,
		GroundedSubjectivityIDs: in.GroundedSubjectivityIDs,
		ToolCalls:               in.ToolCalls, CreatedAt: in.CreatedAt,
	}
}
