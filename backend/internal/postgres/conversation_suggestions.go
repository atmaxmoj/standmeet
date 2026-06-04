// conversation_suggestions.go —— H.13.e: shown ghost text + Tab-accepted
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

// SuggestionRepo —— conversation_suggestions 表的访问入口。
type SuggestionRepo struct {
	pool *Pool
}

// NewSuggestionRepo —— DI 构造。
func NewSuggestionRepo(pool *Pool) *SuggestionRepo {
	return &SuggestionRepo{pool: pool}
}

// RecordShownInput —— POST sessions/{id}/suggestions/shown 入参。
type RecordShownInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         domain.SuggestionSource
	TurnIndex      int32
}

// RecordShown —— append-only 写一条 shown 日志。返回 row id 让 caller
// 拿去后续 accept 调用。
func (r *SuggestionRepo) RecordShown(
	ctx context.Context, in *RecordShownInput,
) (domain.ConversationSuggestion, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.ConversationSuggestion{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return domain.ConversationSuggestion{}, fmt.Errorf("parse conv id: %w", err)
	}
	row, qerr := dbq.New(r.pool).RecordShownSuggestion(ctx, dbq.RecordShownSuggestionParams{
		OwnerID:        ownerUUID,
		ConversationID: convUUID,
		TurnIndex:      in.TurnIndex,
		GhostText:      in.GhostText,
		Source:         string(in.Source),
	})
	if qerr != nil {
		return domain.ConversationSuggestion{}, fmt.Errorf("record shown: %w", qerr)
	}
	return toDomainSuggestion(&row), nil
}

// MarkAccepted —— visitor 按 Tab 时 owner_id-scoped 更新 accepted_at；
// 找不到对应行翻 ErrSuggestionNotFound (route 返 404 / 已被 cascade 删等)。
func (r *SuggestionRepo) MarkAccepted(
	ctx context.Context, ownerID, conversationID, suggestionID string,
) (domain.ConversationSuggestion, error) {
	params, perr := buildAcceptParams(ownerID, conversationID, suggestionID)
	if perr != nil {
		return domain.ConversationSuggestion{}, perr
	}
	row, qerr := dbq.New(r.pool).MarkSuggestionAccepted(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.ConversationSuggestion{}, domain.ErrSuggestionNotFound
		}
		return domain.ConversationSuggestion{}, fmt.Errorf("mark accepted: %w", qerr)
	}
	return toDomainSuggestion(&row), nil
}

func buildAcceptParams(
	ownerID, conversationID, suggestionID string,
) (*dbq.MarkSuggestionAcceptedParams, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(conversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	suggUUID, err := parseUUID(suggestionID)
	if err != nil {
		return nil, fmt.Errorf("parse suggestion id: %w", err)
	}
	return &dbq.MarkSuggestionAcceptedParams{
		ID: suggUUID, ConversationID: convUUID, OwnerID: ownerUUID,
	}, nil
}

// ListByConversation —— admin conversation detail page 拿这个 turn-by-turn
// log 显。owner_id-scoped 防 cross-tenant 漏读。
func (r *SuggestionRepo) ListByConversation(
	ctx context.Context, ownerID, conversationID string,
) ([]domain.ConversationSuggestion, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	convUUID, err := parseUUID(conversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	rows, qerr := dbq.New(r.pool).ListSuggestionsByConversation(ctx,
		dbq.ListSuggestionsByConversationParams{
			ConversationID: convUUID, OwnerID: ownerUUID,
		})
	if qerr != nil {
		return nil, fmt.Errorf("list suggestions: %w", qerr)
	}
	out := make([]domain.ConversationSuggestion, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainSuggestion(&rows[i]))
	}
	return out, nil
}

func toDomainSuggestion(row *dbq.ConversationSuggestion) domain.ConversationSuggestion {
	out := domain.ConversationSuggestion{
		ID:             formatUUID(row.ID),
		OwnerID:        formatUUID(row.OwnerID),
		ConversationID: formatUUID(row.ConversationID),
		TurnIndex:      row.TurnIndex,
		GhostText:      row.GhostText,
		Source:         domain.SuggestionSource(row.Source),
		ShownAt:        row.ShownAt.Time,
	}
	if row.AcceptedAt.Valid {
		t := row.AcceptedAt.Time
		out.AcceptedAt = &t
	}
	return out
}
