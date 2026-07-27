// conversation_ghosts.go —— H.13.e: shown ghost text + Tab-accepted
// 日志的 CRUD。owner_id 在每行 (重复存自 conversation.owner_id) 是为了
// admin "all ghost shown across my conversations" 这种 owner-scoped 查询
// 不用 join；shown 路径每次 LLM follow-up emit / 浏览器渲 ghost 都会写，
// 写入流量比 conversations 高一个数量级。

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

// GhostRepo —— conversation_ghosts 表的访问入口。
type GhostRepo struct {
	pool *pgstore.Pool
}

// NewGhostRepo —— DI 构造。
func NewGhostRepo(pool *pgstore.Pool) *GhostRepo {
	return &GhostRepo{pool: pool}
}

// RecordShownInput —— POST sessions/{id}/ghosts/shown 入参。
type RecordShownInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         entity.GhostSource
	TurnIndex      int32
}

// RecordPolicyInput —— ghost-steering P3 policy ghost 落库入参(source='policy' + heading/hook)。
type RecordPolicyInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	TargetWaypoint string
	FollowsFrom    string
	TurnIndex      int32
}

// RecordPolicy —— 落一条 policy ghost(target_waypoint + follows_from)。返回 row 让 caller 拿 id
// 放进 `ghost` 帧(前端 accept 回填)。
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

// RecordShown —— append-only 写一条 shown 日志。返回 row id 让 caller
// 拿去后续 accept 调用。
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

// MarkAccepted —— visitor 按 Tab 时 owner_id-scoped 更新 accepted_at；
// 找不到对应行翻 ErrGhostNotFound (route 返 404 / 已被 cascade 删等)。
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

// ListByConversation —— admin conversation detail page 拿这个 turn-by-turn
// log 显。owner_id-scoped 防 cross-tenant 漏读。
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
