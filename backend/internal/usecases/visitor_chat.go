// visitor_chat.go —— visitor chat 流式 + RAG + 配额校验。
// 拆自 visitor.go 是 max-lines 限制；session 颁发那一半留在 visitor.go。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// SendMessageInput —— 一次 chat 提问。
type SendMessageInput struct {
	OwnerID        string
	ConversationID string
	Body           string
	Scope          domain.VisitorSessionScope
}

// MessageEvent —— chat 流式事件（token / done / error）。
// 字段顺序按 govet fieldalignment 优化：error 在前（双 ptr），slice 在尾
// （ptr at offset 0 of slice），减小 GC pointer scan range。
type MessageEvent struct {
	Err          error // 'error' kind 携带 err，其余空
	Kind         string
	Text         string
	CitedWikiIDs []string
}

// SendMessage —— 写访客 visitor message → RAG → 调 provider 流式 → 收尾写
// assistant message + citations 到 DB。返回 event channel；caller 写 SSE。
func SendMessage(
	ctx context.Context, deps VisitorDeps, in *SendMessageInput,
) (<-chan MessageEvent, error) {
	if in.Body == "" {
		return nil, ErrEmptyField
	}
	if qerr := enforceTurnQuota(ctx, deps, in); qerr != nil {
		return nil, qerr
	}
	// 1. 写访客 message
	if _, werr := deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID,
		Role:           "visitor",
		Body:           in.Body,
	}); werr != nil {
		return nil, fmt.Errorf("append visitor message: %w", werr)
	}
	// 2. RAG（简化版：拿 owner 全部 wiki，scope 过滤）
	wikis, err := loadScopedWikis(ctx, deps, in.OwnerID, &in.Scope)
	if err != nil {
		return nil, err
	}
	// 3. 调 provider
	out := make(chan MessageEvent, messageEventBufSize)
	go streamReply(ctx, deps, in, wikis, out)
	return out, nil
}

// enforceTurnQuota —— 在写访客 message 之前检查 turns/session。byoai / public
// tier 没有 code，跳过；code tier 有 code.max_turns_per_session 才查。
func enforceTurnQuota(ctx context.Context, deps VisitorDeps, in *SendMessageInput) error {
	conv, err := deps.Conv.GetConversation(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return fmt.Errorf("load conv for quota: %w", err)
	}
	if conv.CodeID == nil {
		return nil
	}
	code, cerr := deps.Codes.GetByID(ctx, *conv.CodeID)
	if cerr != nil {
		return turnQuotaCodeErr(cerr)
	}
	return turnQuotaCheck(ctx, deps, &code, in.ConversationID)
}

func turnQuotaCodeErr(err error) error {
	if errors.Is(err, domain.ErrCodeInvalid) {
		return nil // 旧 conv 上的 code 被删了，不在此处兜
	}
	return fmt.Errorf("load code for quota: %w", err)
}

func turnQuotaCheck(
	ctx context.Context, deps VisitorDeps, code *domain.AccessCode, convID string,
) error {
	if code.MaxTurnsPerSession == nil || *code.MaxTurnsPerSession <= 0 {
		return nil
	}
	count, err := deps.Conv.CountVisitorTurns(ctx, convID)
	if err != nil {
		return fmt.Errorf("count turns: %w", err)
	}
	if count >= *code.MaxTurnsPerSession {
		return domain.ErrTurnQuotaReached
	}
	return nil
}

const (
	maxRAGWikis         = 50
	messageEventBufSize = 64
)

func loadScopedWikis(
	ctx context.Context, deps VisitorDeps, ownerID string, scope *domain.VisitorSessionScope,
) ([]domain.WikiEntry, error) {
	all, err := deps.Wiki.ListByOwner(ctx, ownerID, maxRAGWikis)
	if err != nil {
		return nil, fmt.Errorf("list wiki for rag: %w", err)
	}
	filtered := make([]domain.WikiEntry, 0, len(all))
	for i := range all {
		if !wikiMatchesScope(&all[i], scope) {
			continue
		}
		filtered = append(filtered, all[i])
	}
	return filtered, nil
}

func wikiMatchesScope(w *domain.WikiEntry, scope *domain.VisitorSessionScope) bool {
	if !visibilityAllowed(w.Visibility, scope.VisibilityMax) {
		return false
	}
	if intersect(w.Tags, scope.ExcludedTags) {
		return false
	}
	if len(scope.IncludedTags) == 0 {
		return true
	}
	return intersect(w.Tags, scope.IncludedTags)
}

func visibilityAllowed(actual, maxAllowed string) bool {
	order := map[string]int{"public": 1, "on_request": 2, "private": 3}
	return order[actual] <= order[maxAllowed]
}

func intersect(a, b []string) bool {
	return anyMember(a, indexSet(b))
}

func indexSet(s []string) map[string]struct{} {
	out := make(map[string]struct{}, len(s))
	for _, x := range s {
		out[x] = struct{}{}
	}
	return out
}

func anyMember(s []string, set map[string]struct{}) bool {
	for _, x := range s {
		if _, ok := set[x]; ok {
			return true
		}
	}
	return false
}

func streamReply(
	ctx context.Context, deps VisitorDeps, in *SendMessageInput,
	wikis []domain.WikiEntry, out chan<- MessageEvent,
) {
	defer close(out)
	chunks, ierr := deps.Provider.Stream(ctx, buildChatRequest(deps, in, wikis))
	if ierr != nil {
		out <- MessageEvent{Kind: "error", Err: ierr}
		return
	}
	full, ok := pumpChunks(chunks, out)
	if !ok {
		return
	}
	out <- emitDoneEvent(ctx, deps, in, full, wikis)
}

func buildChatRequest(
	deps VisitorDeps, in *SendMessageInput, wikis []domain.WikiEntry,
) *inference.ChatRequest {
	return &inference.ChatRequest{
		System: buildSystemPrompt(deps, wikis),
		Messages: []inference.Message{
			{Role: "user", Content: in.Body},
		},
	}
}

// pumpChunks 推送 token events；done 信号到达返 (full, true)；
// error chunk 已 emit error event 后返 ("", false)。
func pumpChunks(
	chunks <-chan inference.Chunk, out chan<- MessageEvent,
) (string, bool) {
	var parts []string
	for ch := range chunks {
		if ch.Error != nil {
			out <- MessageEvent{Kind: "error", Err: ch.Error}
			return "", false
		}
		if ch.Text != "" {
			parts = append(parts, ch.Text)
			out <- MessageEvent{Kind: "token", Text: ch.Text}
		}
		if ch.Done {
			return strings.Join(parts, ""), true
		}
	}
	return strings.Join(parts, ""), true
}

func emitDoneEvent(
	ctx context.Context, deps VisitorDeps, in *SendMessageInput,
	full string, wikis []domain.WikiEntry,
) MessageEvent {
	cited := make([]string, 0, len(wikis))
	for i := range wikis {
		cited = append(cited, wikis[i].ID)
	}
	if _, werr := deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID,
		Role:           "assistant",
		Body:           full,
		CitedWikiIDs:   cited,
	}); werr != nil {
		return MessageEvent{Kind: "error", Err: fmt.Errorf("append assistant: %w", werr)}
	}
	return MessageEvent{Kind: "done", Text: full, CitedWikiIDs: cited}
}

func buildSystemPrompt(deps VisitorDeps, wikis []domain.WikiEntry) string {
	_ = deps
	if len(wikis) == 0 {
		return "You are an assistant answering visitor questions."
	}
	parts := make([]string, 0, 2+len(wikis))
	parts = append(parts,
		"You are an assistant answering visitor questions. ",
		"Use the following knowledge entries as ground truth:\n\n",
	)
	for i := range wikis {
		parts = append(parts, fmt.Sprintf("### %s\n%s\n\n", wikis[i].Title, wikis[i].Body))
	}
	return strings.Join(parts, "")
}
