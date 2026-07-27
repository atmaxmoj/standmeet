// ghosts.go —— H.13.e: shown / accept 两条薄 usecase。把 owner_id
// 校验 + repo 调用收成一层，让 routes/public 不必直接依赖 postgres 包。
//
// 这一层不是单纯 passthrough：shown 时校 source 合法 (initial / followup)；
// accept 时校 ownership (repo 的 WHERE 已经带 owner_id 但 usecase 把
// not-found 翻成 domain sentinel)。

package conversation

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// GhostDeps —— routes 注入。
type GhostDeps struct {
	Repo *GhostRepo
}

// RecordGhostShownInput —— POST sessions/{id}/ghosts/shown 入参。
// OwnerID / ConversationID 由 session auth 解出来的；GhostText / Source /
// TurnIndex 来自 visitor 浏览器 body。
type RecordGhostShownInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         string
	TurnIndex      int32
}

// RecordGhostShown —— 校 source 合法 → 写一行。
func RecordGhostShown(
	ctx context.Context, deps *GhostDeps, in *RecordGhostShownInput,
) (Ghost, error) {
	src, perr := ParseGhostSource(in.Source)
	if perr != nil {
		return Ghost{}, fmt.Errorf("parse source: %w", perr)
	}
	if in.GhostText == "" {
		return Ghost{}, apierr.ErrEmptyField
	}
	row, err := deps.Repo.RecordShown(ctx, &RecordShownInput{
		OwnerID:        in.OwnerID,
		ConversationID: in.ConversationID,
		GhostText:      in.GhostText,
		Source:         src,
		TurnIndex:      in.TurnIndex,
	})
	if err != nil {
		return Ghost{}, fmt.Errorf("record shown: %w", err)
	}
	return row, nil
}

// AcceptGhost —— 翻 accepted_at = now()；找不到翻
// ErrGhostNotFound。
func AcceptGhost(
	ctx context.Context, deps *GhostDeps,
	ownerID, conversationID, ghostID string,
) (Ghost, error) {
	row, err := deps.Repo.MarkAccepted(ctx, ownerID, conversationID, ghostID)
	if err != nil {
		return Ghost{}, fmt.Errorf("mark accepted: %w", err)
	}
	return row, nil
}

// ListGhostsForConversation —— admin conversation detail 用。
func ListGhostsForConversation(
	ctx context.Context, deps *GhostDeps, ownerID, conversationID string,
) ([]Ghost, error) {
	rows, err := deps.Repo.ListByConversation(ctx, ownerID, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list ghosts: %w", err)
	}
	return rows, nil
}

// GhostTelemetry —— ghost-steering telemetry: per-waypoint funnel (policy ghosts shown vs accepted)
// for the owner. Owner-scoped; empty when no policy ghosts have fired yet.
func GhostTelemetry(
	ctx context.Context, deps *GhostDeps, ownerID string,
) ([]GhostWaypointStat, error) {
	stats, err := deps.Repo.WaypointTelemetry(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("ghost telemetry: %w", err)
	}
	return stats, nil
}
