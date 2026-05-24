// visitor_chat.go —— visitor chat 流式 + agent-loop retrieval + 配额校验。
//
// retrieval-redesign 后：不再 stuff 全集进 prompt。改成给 inference 注册三个
// retrieval tool (search/read/list_corpus_entries)，让 AI 主动 fetch。
// readCollector 累计 AI 真读过的 entry，emitDoneEvent 从 collector 取 cited。

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
// BYOAIKeyEnc + BYOAIProvider 仅 tier='byoai' 有值；resolver 解密后实例化
// visitor 自己的 provider（owner 不为推理付钱）。其他 tier 走 owner key。
type SendMessageInput struct {
	OwnerID        string
	ConversationID string
	Body           string
	Permissions    []domain.PathPermission
	Tier           string
	BYOAIProvider  string
	BYOAIKeyEnc    []byte
}

// MessageEvent —— chat 流式事件（token / done / error）。
type MessageEvent struct {
	Err             error
	Kind            string
	Text            string
	CitedWikiIDs    []string
	CitedOutputIDs  []string
	CitedWikiRefs   []CitedRef
	CitedOutputRefs []CitedRef
}

// SendMessage —— 写访客 visitor message → agent loop (search/read tools) →
// 流式回复 → 写 assistant message + cited (= AI 真读过的 entry) 到 DB。
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
		retr: prep.retr, out: out,
	})
	return out, nil
}

type sendPrep struct {
	provider inference.Provider
	retr     *retriever
}

// prepareSend —— SendMessage 前的全部 setup。
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
	retr, lerr := buildRetriever(ctx, deps, in.OwnerID, in.Permissions)
	if lerr != nil {
		return sendPrep{}, lerr
	}
	return sendPrep{provider: provider, retr: retr}, nil
}

// preflightSend —— body 非空 + turn quota + resolver。
func preflightSend(
	ctx context.Context, deps VisitorDeps, in *SendMessageInput,
) (inference.Provider, error) {
	if in.Body == "" {
		return nil, ErrEmptyField
	}
	if qerr := enforceTurnQuota(ctx, deps, in); qerr != nil {
		return nil, qerr
	}
	provider, perr := deps.Resolver.Resolve(ctx, &inference.ResolveInput{
		OwnerID:       in.OwnerID,
		Tier:          in.Tier,
		BYOAIProvider: in.BYOAIProvider,
		BYOAIKeyEnc:   in.BYOAIKeyEnc,
	})
	if perr != nil {
		return nil, fmt.Errorf("resolve provider: %w", perr)
	}
	return provider, nil
}

// enforceTurnQuota —— 在写访客 message 之前检查 turns/session。
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
		return nil
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

// buildRetriever —— 加载 wiki + output 给 tool executor 用。retrieval 阶段
// 不再做 ACL 过滤——ACL 由 tool 内部按调用时的 path 评估（search 结果过滤、
// read 直接拒）。这样 path-glob ACL 的 deny 也会被 AI "看到"为"找不到"，
// 而不是"corpus 里没有"。
func buildRetriever(
	ctx context.Context, deps VisitorDeps, ownerID string, perms []domain.PathPermission,
) (*retriever, error) {
	wikis, werr := deps.Wiki.ListByOwner(ctx, ownerID, maxRAGWikis)
	if werr != nil {
		return nil, fmt.Errorf("list wiki for retrieval: %w", werr)
	}
	outputs, oerr := deps.Output.ListByOwner(ctx, ownerID, maxRAGOutputs)
	if oerr != nil {
		return nil, fmt.Errorf("list output for retrieval: %w", oerr)
	}
	return newRetriever(wikis, outputs, perms), nil
}

// streamArgs —— streamReply 的入参打包；revive 限制函数最多 5 个参数。
type streamArgs struct {
	deps     VisitorDeps
	provider inference.Provider
	in       *SendMessageInput
	out      chan<- MessageEvent
	retr     *retriever
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
		deps: args.deps, in: args.in, full: full, retr: args.retr,
	})
}

func buildChatRequest(args *streamArgs) *inference.ChatRequest {
	return &inference.ChatRequest{
		System:      buildSystemPrompt(),
		Messages:    []inference.Message{{Role: "user", Content: args.in.Body}},
		Tools:       retrievalToolSpecs(),
		ExecuteTool: args.retr.Execute,
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
	deps VisitorDeps
	in   *SendMessageInput
	retr *retriever
	full string
}

// emitDoneEvent —— cited = readCollector 累计的 entry，show_as_source=false
// 已在 collector.add* 里抑制；这里直接取 snapshot。
func emitDoneEvent(ctx context.Context, d *doneInput) MessageEvent {
	wikis, outputs := d.retr.collector.snapshot()
	citedWiki := wikiIDsOf(wikis)
	citedOutput := outputIDsOf(outputs)
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
		CitedWikiRefs:   wikiRefsOf(wikis),
		CitedOutputRefs: outputRefsOf(outputs),
	}
}
