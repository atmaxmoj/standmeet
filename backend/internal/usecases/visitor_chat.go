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
	Err            error // 'error' kind 携带 err，其余空
	Kind           string
	Text           string
	CitedWikiIDs   []string
	CitedOutputIDs []string
}

// SendMessage —— 写访客 visitor message → RAG → 调 provider 流式 → 收尾写
// assistant message + citations 到 DB。返回 event channel；caller 写 SSE。
//
// provider 在 goroutine 启动之前就解算 —— ErrOwnerProviderUnconfigured 之类
// 的 setup error 走 HTTP 错误 envelope，不进 SSE error event（前端 toast
// 更友好）。
func SendMessage(
	ctx context.Context, deps VisitorDeps, in *SendMessageInput,
) (<-chan MessageEvent, error) {
	prep, err := prepareSend(ctx, deps, in)
	if err != nil {
		return nil, err
	}
	out := make(chan MessageEvent, messageEventBufSize)
	go streamReply(ctx, &streamArgs{
		deps: deps, provider: prep.provider, in: in,
		wikis: prep.wikis, outputs: prep.outputs, out: out,
	})
	return out, nil
}

type sendPrep struct {
	provider inference.Provider
	wikis    []domain.WikiEntry
	outputs  []domain.OutputEntry
}

// prepareSend —— SendMessage 前的全部 setup。拆 preflight 让 cyclop ≤5。
func prepareSend(
	ctx context.Context, deps VisitorDeps, in *SendMessageInput,
) (sendPrep, error) {
	provider, err := preflightSend(ctx, deps, in)
	if err != nil {
		return sendPrep{}, err
	}
	if _, werr := deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID, Role: "visitor", Body: in.Body,
	}); werr != nil {
		return sendPrep{}, fmt.Errorf("append visitor message: %w", werr)
	}
	corpus, lerr := loadScopedCorpus(ctx, deps, in.OwnerID, &in.Scope)
	if lerr != nil {
		return sendPrep{}, lerr
	}
	return sendPrep{provider: provider, wikis: corpus.Wikis, outputs: corpus.Outputs}, nil
}

// preflightSend —— body 非空 + turn quota + resolver。失败上一层把错误传到
// HTTP envelope；succeed 后才允许写 visitor message。
func preflightSend(
	ctx context.Context, deps VisitorDeps, in *SendMessageInput,
) (inference.Provider, error) {
	if in.Body == "" {
		return nil, ErrEmptyField
	}
	if qerr := enforceTurnQuota(ctx, deps, in); qerr != nil {
		return nil, qerr
	}
	provider, perr := deps.Resolver.Resolve(ctx, in.OwnerID)
	if perr != nil {
		return nil, fmt.Errorf("resolve owner provider: %w", perr)
	}
	return provider, nil
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
	maxRAGOutputs       = 50
	messageEventBufSize = 64
)

// ScopedCorpus —— 加载完成后的 wiki + output 集合，wrap 避开 3-return
// （revive function-result-limit）。
type ScopedCorpus struct {
	Wikis   []domain.WikiEntry
	Outputs []domain.OutputEntry
}

// loadScopedCorpus —— 加载 wiki + output 两层，做 visibility + tag scope
// 过滤。output 会在 prompt 里优先呈现（更精炼），wiki 当 supporting context。
func loadScopedCorpus(
	ctx context.Context, deps VisitorDeps, ownerID string, scope *domain.VisitorSessionScope,
) (ScopedCorpus, error) {
	wikis, werr := loadScopedWikis(ctx, deps, ownerID, scope)
	if werr != nil {
		return ScopedCorpus{}, werr
	}
	outputs, oerr := loadScopedOutputs(ctx, deps, ownerID, scope)
	if oerr != nil {
		return ScopedCorpus{}, oerr
	}
	return ScopedCorpus{Wikis: wikis, Outputs: outputs}, nil
}

func loadScopedWikis(
	ctx context.Context, deps VisitorDeps, ownerID string, scope *domain.VisitorSessionScope,
) ([]domain.WikiEntry, error) {
	all, err := deps.Wiki.ListByOwner(ctx, ownerID, maxRAGWikis)
	if err != nil {
		return nil, fmt.Errorf("list wiki for rag: %w", err)
	}
	filtered := make([]domain.WikiEntry, 0, len(all))
	for i := range all {
		if entryMatchesScope(all[i].Visibility, all[i].Tags, scope) {
			filtered = append(filtered, all[i])
		}
	}
	return filtered, nil
}

func loadScopedOutputs(
	ctx context.Context, deps VisitorDeps, ownerID string, scope *domain.VisitorSessionScope,
) ([]domain.OutputEntry, error) {
	all, err := deps.Output.ListByOwner(ctx, ownerID, maxRAGOutputs)
	if err != nil {
		return nil, fmt.Errorf("list output for rag: %w", err)
	}
	filtered := make([]domain.OutputEntry, 0, len(all))
	for i := range all {
		if entryMatchesScope(all[i].Visibility, all[i].Tags, scope) {
			filtered = append(filtered, all[i])
		}
	}
	return filtered, nil
}

// entryMatchesScope —— wiki / output 共用的 scope 匹配：visibility ≤ max
// + tag include/exclude。Tags 语义两层一致。
func entryMatchesScope(visibility string, tags []string, scope *domain.VisitorSessionScope) bool {
	if !visibilityAllowed(visibility, scope.VisibilityMax) {
		return false
	}
	if intersect(tags, scope.ExcludedTags) {
		return false
	}
	if len(scope.IncludedTags) == 0 {
		return true
	}
	return intersect(tags, scope.IncludedTags)
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

// streamArgs —— streamReply 的入参打包；revive 限制函数最多 5 个参数。
type streamArgs struct {
	deps     VisitorDeps
	provider inference.Provider
	in       *SendMessageInput
	out      chan<- MessageEvent
	wikis    []domain.WikiEntry
	outputs  []domain.OutputEntry
}

func streamReply(ctx context.Context, args *streamArgs) {
	defer close(args.out)
	chunks, ierr := args.provider.Stream(ctx, buildChatRequest(args))
	if ierr != nil {
		args.out <- MessageEvent{Kind: "error", Err: ierr}
		return
	}
	full, ok := pumpChunks(chunks, args.out)
	if !ok {
		return
	}
	args.out <- emitDoneEvent(ctx, &doneInput{
		deps: args.deps, in: args.in, full: full,
		wikis: args.wikis, outputs: args.outputs,
	})
}

func buildChatRequest(args *streamArgs) *inference.ChatRequest {
	return &inference.ChatRequest{
		System: buildSystemPrompt(args.wikis, args.outputs),
		Messages: []inference.Message{
			{Role: "user", Content: args.in.Body},
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

// doneInput —— emitDoneEvent 入参打包；revive argument-limit ≤ 5。
type doneInput struct {
	deps    VisitorDeps
	in      *SendMessageInput
	full    string
	wikis   []domain.WikiEntry
	outputs []domain.OutputEntry
}

func emitDoneEvent(ctx context.Context, d *doneInput) MessageEvent {
	citedWiki := wikiIDsOf(d.wikis)
	citedOutput := outputIDsOf(d.outputs)
	if _, werr := d.deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: d.in.ConversationID,
		Role:           "assistant",
		Body:           d.full,
		CitedWikiIDs:   citedWiki,
		CitedOutputIDs: citedOutput,
	}); werr != nil {
		return MessageEvent{Kind: "error", Err: fmt.Errorf("append assistant: %w", werr)}
	}
	return MessageEvent{
		Kind: "done", Text: d.full,
		CitedWikiIDs: citedWiki, CitedOutputIDs: citedOutput,
	}
}
