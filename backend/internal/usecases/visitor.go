// visitor.go —— visitor session 颁发 + chat 用例。
//
// M6 简化：
//  - RAG：取 owner 全部 visibility=public 且 tag 命中 scope 的 wiki entries
//    作 system context；不走 embedding（M5 schema 没建 embedding 列）。
//  - 推理：走 inference.Provider（M6 跑 mock）。
//  - 流式：直接 yield chunks 给 caller，caller 写 SSE。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// VisitorDeps —— visitor 用例所需。
type VisitorDeps struct {
	Codes    *postgres.CodeRepo
	Conv     *postgres.ConversationRepo
	Wiki     *postgres.WikiRepo
	Owners   *postgres.OwnerRepo
	Sessions *session.VisitorSessionStore
	Provider inference.Provider
}

// IssueCodeSessionInput —— code-tier 访客发起 session 的入参。
type IssueCodeSessionInput struct {
	Code        string
	VisitorName string
}

// IssueCodeSessionResult —— IssueCodeSession 返回的成对结果，避免 3-return。
type IssueCodeSessionResult struct {
	Session      session.IssuedVisitor
	Conversation domain.Conversation
}

// IssueCodeSession —— code-tier session 颁发：查 code → 校验 → 创 conversation
// + visitor session。
func IssueCodeSession(
	ctx context.Context, deps VisitorDeps, in *IssueCodeSessionInput,
) (IssueCodeSessionResult, error) {
	if in.Code == "" {
		return IssueCodeSessionResult{}, ErrEmptyField
	}
	code, err := lookupAccessCode(ctx, deps, in.Code)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return finalizeCodeSession(ctx, deps, in, &code)
}

func lookupAccessCode(
	ctx context.Context, deps VisitorDeps, codeStr string,
) (domain.AccessCode, error) {
	code, err := deps.Codes.GetByCode(ctx, codeStr)
	if err != nil {
		if errors.Is(err, domain.ErrCodeInvalid) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("get code: %w", err)
	}
	return code, nil
}

func finalizeCodeSession(
	ctx context.Context, deps VisitorDeps,
	in *IssueCodeSessionInput, code *domain.AccessCode,
) (IssueCodeSessionResult, error) {
	conv, err := deps.Conv.CreateConversation(ctx, &postgres.CreateConvInput{
		OwnerID:     code.OwnerID,
		Tier:        "code",
		CodeID:      &code.ID,
		VisitorName: in.VisitorName,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("create conversation: %w", err)
	}
	issued, err := deps.Sessions.Issue(ctx, &session.VisitorSessionData{
		OwnerID:       code.OwnerID,
		Tier:          "code",
		CodeID:        code.ID,
		VisitorName:   in.VisitorName,
		IncludedTags:  code.IncludedTags,
		ExcludedTags:  code.ExcludedTags,
		VisibilityMax: "private", // code-tier 可读 private wiki（owner 通过 code scope 控制）
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return IssueCodeSessionResult{Session: issued, Conversation: conv}, nil
}

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
	// 1. 写访客 message
	if _, werr := deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID,
		Role:           "visitor",
		Body:           in.Body,
	}); werr != nil {
		return nil, fmt.Errorf("append visitor message: %w", werr)
	}
	// 2. RAG（M6 简化版：拿 owner 全部 wiki，scope 过滤）
	wikis, err := loadScopedWikis(ctx, deps, in.OwnerID, &in.Scope)
	if err != nil {
		return nil, err
	}
	// 3. 调 provider
	out := make(chan MessageEvent, messageEventBufSize)
	go streamReply(ctx, deps, in, wikis, out)
	return out, nil
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
