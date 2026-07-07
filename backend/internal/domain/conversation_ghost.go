// conversation_ghost.go —— H.13.e: visitor 输入框 ghost text 的
// shown / accept 日志 domain。owner admin 详情页用这个看每 turn 推了什么、
// visitor 是否接受。
//
// Source 区分初始队列 (KindInitial：源 access_codes.ghosts)
// 和后续 follow-up (KindFollowup：源 SSE `ghosts` 帧)。
//
// AcceptedAt nil = visitor 只看到没按 Tab；非 nil = visitor 按 Tab 接受
// 的时刻 (server now())。

package domain

import (
	"errors"
	"time"
)

// GhostSource —— ghost 来源；持久化为字符串。
type GhostSource string

const (
	// GhostInitial 来自 owner 在建码时填的 ghosts。
	GhostInitial GhostSource = "initial"
	// GhostFollowup 来自 backend agent_turn 收尾的 inference.Generate
	// 子调用 (每轮 AI 答完追加 3 条 follow-up)。
	GhostFollowup GhostSource = "followup"
)

// ErrInvalidGhostSource —— shown route 收到非法 source 字串时返。
var ErrInvalidGhostSource = errors.New("invalid ghost source")

// ErrGhostNotFound —— accept route 找不到 ghost id (visitor
// 给错 / row 已被 cascade 删) 返 404。
var ErrGhostNotFound = errors.New("ghost not found")

// ConversationGhost —— 一条 shown 日志。AcceptedAt 后续 accept route
// 把 nil → 真时刻。
type ConversationGhost struct {
	ShownAt        time.Time
	AcceptedAt     *time.Time
	ID             string
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         GhostSource
	TurnIndex      int32
}

// Accepted —— visitor 是否按 Tab 接受过 (admin UI 用)。
func (s *ConversationGhost) Accepted() bool {
	return s.AcceptedAt != nil
}

// GhostWaypointStat —— ghost-steering telemetry: 一个 waypoint 的漏斗(policy ghost shown vs accepted)。
type GhostWaypointStat struct {
	TargetWaypoint string
	Shown          int64
	Accepted       int64
}

// AcceptanceRate —— accepted/shown，四舍五入到小数(shown=0 → 0)。
func (s *GhostWaypointStat) AcceptanceRate() float64 {
	if s.Shown == 0 {
		return 0
	}
	return float64(s.Accepted) / float64(s.Shown)
}

// ParseGhostSource —— route 输入校验；非法返 sentinel。
func ParseGhostSource(s string) (GhostSource, error) {
	switch GhostSource(s) {
	case GhostInitial, GhostFollowup:
		return GhostSource(s), nil
	}
	return "", ErrInvalidGhostSource
}
