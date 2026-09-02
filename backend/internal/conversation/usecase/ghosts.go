// ghosts.go —— H.13.e: two thin use cases, shown / accept. Collects owner_id
// validation + repo calls into one layer so routes/public don't need to depend on the
// postgres package directly.
//
// This layer isn't pure passthrough: shown validates source is legal (initial /
// followup); accept validates ownership (the repo's WHERE already carries owner_id, but
// the usecase translates not-found into a domain sentinel).

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// GhostDeps —— injected by routes.
type GhostDeps struct {
	Repo *repo.GhostRepo
}

// RecordGhostShownInput —— input for POST sessions/{id}/ghosts/shown.
// OwnerID / ConversationID are resolved from session auth; GhostText / Source /
// TurnIndex come from the visitor browser's body.
type RecordGhostShownInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         string
	TurnIndex      int32
}

// RecordGhostShown —— validates source is legal → writes one row.
func RecordGhostShown(
	ctx context.Context, deps *GhostDeps, in *RecordGhostShownInput,
) (entity.Ghost, error) {
	src, perr := entity.ParseGhostSource(in.Source)
	if perr != nil {
		return entity.Ghost{}, fmt.Errorf("parse source: %w", perr)
	}
	if in.GhostText == "" {
		return entity.Ghost{}, apierr.ErrEmptyField
	}
	row, err := deps.Repo.RecordShown(ctx, &repo.RecordShownInput{
		OwnerID:        in.OwnerID,
		ConversationID: in.ConversationID,
		GhostText:      in.GhostText,
		Source:         src,
		TurnIndex:      in.TurnIndex,
	})
	if err != nil {
		return entity.Ghost{}, fmt.Errorf("record shown: %w", err)
	}
	return row, nil
}

// AcceptGhost —— sets accepted_at = now(); returns ErrGhostNotFound when not found.
func AcceptGhost(
	ctx context.Context, deps *GhostDeps,
	ownerID, conversationID, ghostID string,
) (entity.Ghost, error) {
	row, err := deps.Repo.MarkAccepted(ctx, ownerID, conversationID, ghostID)
	if err != nil {
		return entity.Ghost{}, fmt.Errorf("mark accepted: %w", err)
	}
	return row, nil
}

// ListGhostsForConversation —— used by admin conversation detail.
func ListGhostsForConversation(
	ctx context.Context, deps *GhostDeps, ownerID, conversationID string,
) ([]entity.Ghost, error) {
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
) ([]entity.GhostWaypointStat, error) {
	stats, err := deps.Repo.WaypointTelemetry(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("ghost telemetry: %w", err)
	}
	return stats, nil
}
