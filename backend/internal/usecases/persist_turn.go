// persist_turn.go —— D-5 regression 修：visitor pi-agent-core flow 不再
// 经过 backend SendMessage，需要单独 endpoint 落 user + assistant 两条
// message。这里是 usecase 层 (routes/public/persist_turn.go 是 wire-only
// handler，避开 routes-cyclo 限制)。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// PersistTurnSEOLookup —— PersistVisitorTurn 需要的 SEO 反查窄接口
// (避开 publicroutes 直接 import postgres)。*postgres.SEORepo 满足。
type PersistTurnSEOLookup interface {
	GetWikiByPath(ctx context.Context, ownerID, path string) (domain.Wiki, error)
	GetOutputByPath(ctx context.Context, ownerID, path string) (domain.Output, error)
}

// PersistTurnDeps —— PersistVisitorTurn 需要的依赖。
type PersistTurnDeps struct {
	Conv *postgres.ConversationRepo
	SEO  PersistTurnSEOLookup
	Log  *slog.Logger
}

// PersistVisitorTurnInput —— 一轮完成后写两条 message。
type PersistVisitorTurnInput struct {
	OwnerID          string
	ConversationID   string
	UserText         string
	AssistantText    string
	CitedWikiPaths   []string
	CitedOutputPaths []string
}

// PersistVisitorTurn —— 落 user message → 解 cited paths → 落 assistant message。
// AssistantText 空时只落 user (e.g. 出错的 turn 也想留下用户问题)。
func PersistVisitorTurn(
	ctx context.Context, deps *PersistTurnDeps, in *PersistVisitorTurnInput,
) error {
	if _, werr := deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID, Role: "visitor", Body: in.UserText,
	}); werr != nil {
		return fmt.Errorf("append visitor message: %w", werr)
	}
	if in.AssistantText == "" {
		return nil
	}
	wikiIDs := resolvePathsWiki(ctx, deps, in.OwnerID, in.CitedWikiPaths)
	outputIDs := resolvePathsOutput(ctx, deps, in.OwnerID, in.CitedOutputPaths)
	if _, aerr := deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID, Role: "assistant", Body: in.AssistantText,
		CitedWikiIDs: wikiIDs, CitedOutputIDs: outputIDs,
	}); aerr != nil {
		return fmt.Errorf("append assistant message: %w", aerr)
	}
	return nil
}

func resolvePathsWiki(
	ctx context.Context, deps *PersistTurnDeps, ownerID string, paths []string,
) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if id, ok := lookupWikiID(ctx, deps, ownerID, p); ok {
			out = append(out, id)
		}
	}
	return out
}

func resolvePathsOutput(
	ctx context.Context, deps *PersistTurnDeps, ownerID string, paths []string,
) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if id, ok := lookupOutputID(ctx, deps, ownerID, p); ok {
			out = append(out, id)
		}
	}
	return out
}

func lookupWikiID(
	ctx context.Context, deps *PersistTurnDeps, ownerID, path string,
) (string, bool) {
	if deps.SEO == nil {
		return "", false
	}
	w, err := deps.SEO.GetWikiByPath(ctx, ownerID, path)
	if err != nil {
		logIfUnexpectedNotFound(deps.Log, err, domain.ErrWikiNotFound, "wiki", path)
		return "", false
	}
	return w.ID(), true
}

func lookupOutputID(
	ctx context.Context, deps *PersistTurnDeps, ownerID, path string,
) (string, bool) {
	if deps.SEO == nil {
		return "", false
	}
	o, err := deps.SEO.GetOutputByPath(ctx, ownerID, path)
	if err != nil {
		logIfUnexpectedNotFound(deps.Log, err, domain.ErrOutputNotFound, "output", path)
		return "", false
	}
	return o.ID(), true
}

func logIfUnexpectedNotFound(
	log *slog.Logger, err, notFound error, kind, path string,
) {
	if errors.Is(err, notFound) {
		return
	}
	log.Warn("persist turn lookup", "kind", kind, "path", path, "err", err)
}
