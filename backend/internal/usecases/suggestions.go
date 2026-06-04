// suggestions.go —— H.13.e: shown / accept 两条薄 usecase。把 owner_id
// 校验 + repo 调用收成一层，让 routes/public 不必直接依赖 postgres 包。
//
// 这一层不是单纯 passthrough：shown 时校 source 合法 (initial / followup)；
// accept 时校 ownership (repo 的 WHERE 已经带 owner_id 但 usecase 把
// not-found 翻成 domain sentinel)。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// SuggestionDeps —— routes 注入。
type SuggestionDeps struct {
	Repo *postgres.SuggestionRepo
}

// RecordSuggestionShownInput —— POST sessions/{id}/suggestions/shown 入参。
// OwnerID / ConversationID 由 session auth 解出来的；GhostText / Source /
// TurnIndex 来自 visitor 浏览器 body。
type RecordSuggestionShownInput struct {
	OwnerID        string
	ConversationID string
	GhostText      string
	Source         string
	TurnIndex      int32
}

// RecordSuggestionShown —— 校 source 合法 → 写一行。
func RecordSuggestionShown(
	ctx context.Context, deps *SuggestionDeps, in *RecordSuggestionShownInput,
) (domain.ConversationSuggestion, error) {
	src, perr := domain.ParseSuggestionSource(in.Source)
	if perr != nil {
		return domain.ConversationSuggestion{}, fmt.Errorf("parse source: %w", perr)
	}
	if in.GhostText == "" {
		return domain.ConversationSuggestion{}, ErrEmptyField
	}
	row, err := deps.Repo.RecordShown(ctx, &postgres.RecordShownInput{
		OwnerID:        in.OwnerID,
		ConversationID: in.ConversationID,
		GhostText:      in.GhostText,
		Source:         src,
		TurnIndex:      in.TurnIndex,
	})
	if err != nil {
		return domain.ConversationSuggestion{}, fmt.Errorf("record shown: %w", err)
	}
	return row, nil
}

// AcceptSuggestion —— 翻 accepted_at = now()；找不到翻
// domain.ErrSuggestionNotFound。
func AcceptSuggestion(
	ctx context.Context, deps *SuggestionDeps,
	ownerID, conversationID, suggestionID string,
) (domain.ConversationSuggestion, error) {
	row, err := deps.Repo.MarkAccepted(ctx, ownerID, conversationID, suggestionID)
	if err != nil {
		return domain.ConversationSuggestion{}, fmt.Errorf("mark accepted: %w", err)
	}
	return row, nil
}

// ListSuggestionsForConversation —— admin conversation detail 用。
func ListSuggestionsForConversation(
	ctx context.Context, deps *SuggestionDeps, ownerID, conversationID string,
) ([]domain.ConversationSuggestion, error) {
	rows, err := deps.Repo.ListByConversation(ctx, ownerID, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list suggestions: %w", err)
	}
	return rows, nil
}
