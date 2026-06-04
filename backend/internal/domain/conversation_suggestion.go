// conversation_suggestion.go —— H.13.e: visitor 输入框 ghost text 的
// shown / accept 日志 domain。owner admin 详情页用这个看每 turn 推了什么、
// visitor 是否接受。
//
// Source 区分初始队列 (KindInitial：源 access_codes.suggested_questions)
// 和后续 follow-up (KindFollowup：源 SSE `suggestions` 帧)。
//
// AcceptedAt nil = visitor 只看到没按 Tab；非 nil = visitor 按 Tab 接受
// 的时刻 (server now())。

package domain

import (
	"errors"
	"time"
)

// SuggestionSource —— ghost 来源；持久化为字符串。
type SuggestionSource string

const (
	// SuggestionInitial 来自 owner 在建码时填的 suggested_questions。
	SuggestionInitial SuggestionSource = "initial"
	// SuggestionFollowup 来自 backend agent_turn 收尾的 inference.Generate
	// 子调用 (每轮 AI 答完追加 3 条 follow-up)。
	SuggestionFollowup SuggestionSource = "followup"
)

// ErrInvalidSuggestionSource —— shown route 收到非法 source 字串时返。
var ErrInvalidSuggestionSource = errors.New("invalid suggestion source")

// ErrSuggestionNotFound —— accept route 找不到 suggestion id (visitor
// 给错 / row 已被 cascade 删) 返 404。
var ErrSuggestionNotFound = errors.New("suggestion not found")

// ConversationSuggestion —— 一条 shown 日志。AcceptedAt 后续 accept route
// 把 nil → 真时刻。
type ConversationSuggestion struct {
	ShownAt        time.Time
	AcceptedAt     *time.Time
	ID             string
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         SuggestionSource
	TurnIndex      int32
}

// Accepted —— visitor 是否按 Tab 接受过 (admin UI 用)。
func (s *ConversationSuggestion) Accepted() bool {
	return s.AcceptedAt != nil
}

// ParseSuggestionSource —— route 输入校验；非法返 sentinel。
func ParseSuggestionSource(s string) (SuggestionSource, error) {
	switch SuggestionSource(s) {
	case SuggestionInitial, SuggestionFollowup:
		return SuggestionSource(s), nil
	}
	return "", ErrInvalidSuggestionSource
}
