// conversation_ghosts.go — H.13.e: CRUD for the shown-ghost-text + Tab-accepted log.
// owner_id sits on every row (denormalized from conversation.owner_id) so an
// admin owner-scoped query like "all ghost shown across my conversations" doesn't
// need a join; the shown path writes on every LLM follow-up emit / every ghost the
// browser renders, so its write volume is an order of magnitude higher than
// conversations.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GhostRepo — access entry point for the conversation_ghosts table.
type GhostRepo struct {
	pool *pgstore.Pool
}

// NewGhostRepo — DI constructor.
func NewGhostRepo(pool *pgstore.Pool) *GhostRepo {
	return &GhostRepo{pool: pool}
}

// RecordShownInput — input for POST sessions/{id}/ghosts/shown.
type RecordShownInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         entity.GhostSource
	TurnIndex      int32
}

// RecordPolicyInput — input for persisting a ghost-steering P3 policy ghost
// (source='policy' + heading/hook).
type RecordPolicyInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	TargetWaypoint string
	FollowsFrom    string
	TurnIndex      int32
}

// RecordPolicy — writes one policy ghost (target_waypoint + follows_from). Returns the
// row so the caller can put its id into the `ghost` frame (frontend fills it back in
// on accept).
func (r *GhostRepo) RecordPolicy(
	ctx context.Context, in *RecordPolicyInput,
) (entity.Ghost, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Ghost{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	convUUID, err := pgstore.ParseUUID(in.ConversationID)
	if err != nil {
		return entity.Ghost{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := db.New(r.pool).RecordPolicyGhost(ctx, db.RecordPolicyGhostParams{
		OwnerID: ownerUUID, ConversationID: convUUID, TurnIndex: in.TurnIndex,
		GhostText: in.GhostText, TargetWaypoint: &in.TargetWaypoint, FollowsFrom: &in.FollowsFrom,
	})
	if qerr != nil {
		return entity.Ghost{}, fmt.Errorf("record policy ghost: %w", qerr)
	}
	return toDomainGhost(&row), nil
}

// RecordShown — append-only write of one shown log entry. Returns the row id so the
// caller can use it in a subsequent accept call.
func (r *GhostRepo) RecordShown(
	ctx context.Context, in *RecordShownInput,
) (entity.Ghost, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Ghost{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	convUUID, err := pgstore.ParseUUID(in.ConversationID)
	if err != nil {
		return entity.Ghost{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := db.New(r.pool).RecordShownGhost(ctx, db.RecordShownGhostParams{
		OwnerID:        ownerUUID,
		ConversationID: convUUID,
		TurnIndex:      in.TurnIndex,
		GhostText:      in.GhostText,
		Source:         string(in.Source),
	})
	if qerr != nil {
		return entity.Ghost{}, fmt.Errorf("record shown: %w", qerr)
	}
	return toDomainGhost(&row), nil
}

// MarkAccepted — updates accepted_at, owner_id-scoped, when the visitor presses Tab;
// no matching row translates to ErrGhostNotFound (route returns 404 / already
// cascade-deleted, etc.).
func (r *GhostRepo) MarkAccepted(
	ctx context.Context, ownerID, conversationID, ghostID string,
) (entity.Ghost, error) {
	params, perr := buildAcceptParams(ownerID, conversationID, ghostID)
	if perr != nil {
		return entity.Ghost{}, perr
	}
	row, qerr := db.New(r.pool).MarkGhostAccepted(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Ghost{}, entity.ErrGhostNotFound
		}
		return entity.Ghost{}, fmt.Errorf("mark accepted: %w", qerr)
	}
	return toDomainGhost(&row), nil
}

func buildAcceptParams(
	ownerID, conversationID, ghostID string,
) (*db.MarkGhostAcceptedParams, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	convUUID, err := pgstore.ParseUUID(conversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	suggUUID, err := pgstore.ParseUUID(ghostID)
	if err != nil {
		return nil, fmt.Errorf("parse ghost id: %w", err)
	}
	return &db.MarkGhostAcceptedParams{
		ID: suggUUID, ConversationID: convUUID, OwnerID: ownerUUID,
	}, nil
}

// ListByConversation — the admin conversation detail page fetches this turn-by-turn
// log to display. owner_id-scoped to prevent a cross-tenant read leak.
func (r *GhostRepo) ListByConversation(
	ctx context.Context, ownerID, conversationID string,
) ([]entity.Ghost, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	convUUID, err := pgstore.ParseUUID(conversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	rows, qerr := db.New(r.pool).ListGhostsByConversation(ctx,
		db.ListGhostsByConversationParams{
			ConversationID: convUUID, OwnerID: ownerUUID,
		})
	if qerr != nil {
		return nil, fmt.Errorf("list ghosts: %w", qerr)
	}
	out := make([]entity.Ghost, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainGhost(&rows[i]))
	}
	return out, nil
}

// WaypointTelemetry —— ghost-steering telemetry: per-waypoint funnel (policy ghosts shown vs
// accepted) for the owner. Owner-scoped aggregate; empty slice when no policy ghosts yet.
func (r *GhostRepo) WaypointTelemetry(
	ctx context.Context, ownerID string,
) ([]entity.GhostWaypointStat, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).GhostWaypointTelemetry(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("ghost telemetry: %w", qerr)
	}
	out := make([]entity.GhostWaypointStat, 0, len(rows))
	for i := range rows {
		wp := ""
		if rows[i].TargetWaypoint != nil {
			wp = *rows[i].TargetWaypoint
		}
		out = append(out, entity.GhostWaypointStat{
			TargetWaypoint: wp,
			Shown:          rows[i].Shown,
			Accepted:       rows[i].Accepted,
		})
	}
	return out, nil
}

func toDomainGhost(row *db.ConversationGhost) entity.Ghost {
	out := entity.Ghost{
		ID:             pgstore.FormatUUID(row.ID),
		OwnerID:        pgstore.FormatUUID(row.OwnerID),
		ConversationID: pgstore.FormatUUID(row.ConversationID),
		TurnIndex:      row.TurnIndex,
		GhostText:      row.GhostText,
		Source:         entity.GhostSource(row.Source),
		ShownAt:        row.ShownAt.Time,
	}
	if row.AcceptedAt.Valid {
		t := row.AcceptedAt.Time
		out.AcceptedAt = &t
	}
	return out
}
