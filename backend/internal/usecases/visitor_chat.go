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
//
// Permissions 是从 session 继承的 path-glob ACL；retrieval 阶段会按它过滤。
// 当前 pass-through 实现还没接 path-glob 评估（占位 TODO）。
type SendMessageInput struct {
	OwnerID        string
	ConversationID string
	Body           string
	Permissions    []domain.PathPermission
}

// MessageEvent —— chat 流式事件（token / done / error）。
// 字段顺序按 govet fieldalignment 优化：error 在前（双 ptr），slice 在尾
// （ptr at offset 0 of slice），减小 GC pointer scan range。
type MessageEvent struct {
	Err             error // 'error' kind 携带 err，其余空
	Kind            string
	Text            string
	CitedWikiIDs    []string
	CitedOutputIDs  []string
	CitedWikiRefs   []CitedRef
	CitedOutputRefs []CitedRef
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
	corpus, lerr := loadCorpusForACL(ctx, deps, in.OwnerID, in.Permissions)
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

// loadCorpusForACL —— 加载 wiki + output 两层，按 path-glob ACL 过滤。
// 空 permissions = 允许全部（无 ACL）；非空时 PathACL.Allows 评估每条 entry
// 的 Path。Entry.Path 为 nil 时跳过 ACL 评估（path 没设的 entry 仅当
// permissions 为空时进入 corpus，符合"默认 deny"的安全语义）。
func loadCorpusForACL(
	ctx context.Context, deps VisitorDeps, ownerID string, perms []domain.PathPermission,
) (ScopedCorpus, error) {
	wikis, werr := deps.Wiki.ListByOwner(ctx, ownerID, maxRAGWikis)
	if werr != nil {
		return ScopedCorpus{}, fmt.Errorf("list wiki for rag: %w", werr)
	}
	outputs, oerr := deps.Output.ListByOwner(ctx, ownerID, maxRAGOutputs)
	if oerr != nil {
		return ScopedCorpus{}, fmt.Errorf("list output for rag: %w", oerr)
	}
	acl := domain.NewPathACL(perms)
	return ScopedCorpus{
		Wikis:   filterWikiByACL(wikis, acl),
		Outputs: filterOutputByACL(outputs, acl),
	}, nil
}

func filterWikiByACL(entries []domain.WikiEntry, acl domain.PathACL) []domain.WikiEntry {
	out := make([]domain.WikiEntry, 0, len(entries))
	for i := range entries {
		if acl.AllowsEntry(pathOrNil(entries[i].Path)) {
			out = append(out, entries[i])
		}
	}
	return out
}

func filterOutputByACL(entries []domain.OutputEntry, acl domain.PathACL) []domain.OutputEntry {
	out := make([]domain.OutputEntry, 0, len(entries))
	for i := range entries {
		if acl.AllowsEntry(pathOrNil(entries[i].Path)) {
			out = append(out, entries[i])
		}
	}
	return out
}

func pathOrNil(p *string) string {
	if p == nil {
		return ""
	}
	return *p
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
	// show_as_source=false 的 entry：AI 可读 (已经在 prompt 里) 但不进
	// cited footer。读 + 引用是两个面，hidden 走"读不挂"。
	citedWikis := keepCitedWikis(d.wikis)
	citedOutputs := keepCitedOutputs(d.outputs)
	citedWiki := wikiIDsOf(citedWikis)
	citedOutput := outputIDsOf(citedOutputs)
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
		CitedWikiRefs:   wikiRefsOf(citedWikis),
		CitedOutputRefs: outputRefsOf(citedOutputs),
	}
}

func keepCitedWikis(in []domain.WikiEntry) []domain.WikiEntry {
	out := make([]domain.WikiEntry, 0, len(in))
	for i := range in {
		if in[i].ShowAsSource {
			out = append(out, in[i])
		}
	}
	return out
}

func keepCitedOutputs(in []domain.OutputEntry) []domain.OutputEntry {
	out := make([]domain.OutputEntry, 0, len(in))
	for i := range in {
		if in[i].ShowAsSource {
			out = append(out, in[i])
		}
	}
	return out
}
