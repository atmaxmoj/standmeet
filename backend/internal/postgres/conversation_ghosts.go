// conversation_ghosts.go —— H.13.e: shown ghost text + Tab-accepted
// 日志的 CRUD。owner_id 在每行 (重复存自 conversation.owner_id) 是为了
// admin "all ghost shown across my conversations" 这种 owner-scoped 查询
// 不用 join；shown 路径每次 LLM follow-up emit / 浏览器渲 ghost 都会写，
// 写入流量比 conversations 高一个数量级。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// GhostRepo —— conversation_ghosts 表的访问入口。
type GhostRepo struct {
	pool *Pool
}

// NewGhostRepo —— DI 构造。
func NewGhostRepo(pool *Pool) *GhostRepo {
	return &GhostRepo{pool: pool}
}

// RecordShownInput —— POST sessions/{id}/ghosts/shown 入参。
type RecordShownInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         domain.GhostSource
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
) (domain.ConversationGhost, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.ConversationGhost{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return domain.ConversationGhost{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := dbq.New(r.pool).RecordPolicyGhost(ctx, dbq.RecordPolicyGhostParams{
		OwnerID: ownerUUID, ConversationID: convUUID, TurnIndex: in.TurnIndex,
		GhostText: in.GhostText, TargetWaypoint: &in.TargetWaypoint, FollowsFrom: &in.FollowsFrom,
	})
	if qerr != nil {
		return domain.ConversationGhost{}, fmt.Errorf("record policy ghost: %w", qerr)
	}
	return toDomainGhost(&row), nil
}

// RecordShown —— append-only 写一条 shown 日志。返回 row id 让 caller
// 拿去后续 accept 调用。
func (r *GhostRepo) RecordShown(
	ctx context.Context, in *RecordShownInput,
) (domain.ConversationGhost, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.ConversationGhost{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return domain.ConversationGhost{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := dbq.New(r.pool).RecordShownGhost(ctx, dbq.RecordShownGhostParams{
		OwnerID:        ownerUUID,
		ConversationID: convUUID,
		TurnIndex:      in.TurnIndex,
		GhostText:      in.GhostText,
		Source:         string(in.Source),
	})
	if qerr != nil {
		return domain.ConversationGhost{}, fmt.Errorf("record shown: %w", qerr)
	}
	return toDomainGhost(&row), nil
}

// MarkAccepted —— visitor 按 Tab 时 owner_id-scoped 更新 accepted_at；
// 找不到对应行翻 ErrGhostNotFound (route 返 404 / 已被 cascade 删等)。
func (r *GhostRepo) MarkAccepted(
	ctx context.Context, ownerID, conversationID, ghostID string,
) (domain.ConversationGhost, error) {
	params, perr := buildAcceptParams(ownerID, conversationID, ghostID)
	if perr != nil {
		return domain.ConversationGhost{}, perr
	}
	row, qerr := dbq.New(r.pool).MarkGhostAccepted(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.ConversationGhost{}, domain.ErrGhostNotFound
		}
		return domain.ConversationGhost{}, fmt.Errorf("mark accepted: %w", qerr)
	}
	return toDomainGhost(&row), nil
}

func buildAcceptParams(
	ownerID, conversationID, ghostID string,
) (*dbq.MarkGhostAcceptedParams, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(conversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	suggUUID, err := parseUUID(ghostID)
	if err != nil {
		return nil, fmt.Errorf("parse ghost id: %w", err)
	}
	return &dbq.MarkGhostAcceptedParams{
		ID: suggUUID, ConversationID: convUUID, OwnerID: ownerUUID,
	}, nil
}

// ListByConversation —— admin conversation detail page 拿这个 turn-by-turn
// log 显。owner_id-scoped 防 cross-tenant 漏读。
func (r *GhostRepo) ListByConversation(
	ctx context.Context, ownerID, conversationID string,
) ([]domain.ConversationGhost, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(conversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	rows, qerr := dbq.New(r.pool).ListGhostsByConversation(ctx,
		dbq.ListGhostsByConversationParams{
			ConversationID: convUUID, OwnerID: ownerUUID,
		})
	if qerr != nil {
		return nil, fmt.Errorf("list ghosts: %w", qerr)
	}
	out := make([]domain.ConversationGhost, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainGhost(&rows[i]))
	}
	return out, nil
}

// WaypointTelemetry —— ghost-steering telemetry: per-waypoint funnel (policy ghosts shown vs
// accepted) for the owner. Owner-scoped aggregate; empty slice when no policy ghosts yet.
func (r *GhostRepo) WaypointTelemetry(
	ctx context.Context, ownerID string,
) ([]domain.GhostWaypointStat, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).GhostWaypointTelemetry(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("ghost telemetry: %w", qerr)
	}
	out := make([]domain.GhostWaypointStat, 0, len(rows))
	for i := range rows {
		wp := ""
		if rows[i].TargetWaypoint != nil {
			wp = *rows[i].TargetWaypoint
		}
		out = append(out, domain.GhostWaypointStat{
			TargetWaypoint: wp,
			Shown:          rows[i].Shown,
			Accepted:       rows[i].Accepted,
		})
	}
	return out, nil
}

func toDomainGhost(row *dbq.ConversationGhost) domain.ConversationGhost {
	out := domain.ConversationGhost{
		ID:             formatUUID(row.ID),
		OwnerID:        formatUUID(row.OwnerID),
		ConversationID: formatUUID(row.ConversationID),
		TurnIndex:      row.TurnIndex,
		GhostText:      row.GhostText,
		Source:         domain.GhostSource(row.Source),
		ShownAt:        row.ShownAt.Time,
	}
	if row.AcceptedAt.Valid {
		t := row.AcceptedAt.Time
		out.AcceptedAt = &t
	}
	return out
}
