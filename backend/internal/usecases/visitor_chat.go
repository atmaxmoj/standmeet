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
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

const queryQueueTimeout = 15 * time.Second

// SendMessageInput —— 一次 chat 提问。
//
// BYOAI 仅 tier='byoai' 时非 nil。形态是 domain.AICredential，同一个 struct
// 同时覆盖 visitor BYOAI（route layer 从 X-BYOAI-* headers 解封而来）+ owner
// 自配 provider（OwnerKeyResolver 从 DB 解密而来）。request-scoped，不在
// server 任何持久层缓存。
// fieldalignment：BYOAI pointer 跟 strings 交错；govet 推荐顺序见 lint 输出。
type SendMessageInput struct {
	BYOAI          *domain.AICredential
	MaxBookings    *int32
	RoleSnapshot   *domain.RoleSnapshot
	OwnerID        string
	ConversationID string
	Body           string
	Mode           string
	CodeID         string
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
//
// Queue 限流：单 session 同时 1 个 in-flight + 全局 maxConcurrent。拿不到位
// (busy / timeout) 直接返 error，caller 翻 HTTP envelope，不进 SSE。
func SendMessage(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (<-chan MessageEvent, error) {
	if qerr := acquireQuerySlot(ctx, deps, in.ConversationID); qerr != nil {
		return nil, qerr
	}
	prep, err := prepareSend(ctx, deps, in)
	if err != nil {
		releaseQuerySlot(deps, in.ConversationID)
		return nil, err
	}
	out := make(chan MessageEvent, messageEventBufSize)
	go streamReply(ctx, &streamArgs{
		deps: deps, provider: prep.provider, in: in,
		retr: prep.retr, skills: prep.skills, extMCP: prep.extMCP,
		booker: prep.booker, out: out,
	})
	return out, nil
}

func acquireQuerySlot(ctx context.Context, deps *VisitorDeps, sessionID string) error {
	if deps.Queue == nil {
		return nil
	}
	if err := deps.Queue.Acquire(ctx, sessionID, queryQueueTimeout); err != nil {
		return fmt.Errorf("acquire query slot: %w", err)
	}
	return nil
}

func releaseQuerySlot(deps *VisitorDeps, sessionID string) {
	if deps.Queue != nil {
		deps.Queue.Release(sessionID)
	}
}

// 让 session import 保持 in-use（streamReply defer 里也释放）。
var _ = session.ErrQueueTimeout

type sendPrep struct {
	provider inference.Provider
	retr     *retriever
	skills   *skillToolBundle
	extMCP   *externalMCPBundle
	booker   *bookerBundle
}

// prepareSend —— SendMessage 前的全部 setup。
func prepareSend(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (sendPrep, error) {
	provider, err := preflightSend(ctx, deps, in)
	if err != nil {
		return sendPrep{}, err
	}
	if aerr := appendVisitorTurn(ctx, deps, in); aerr != nil {
		return sendPrep{}, aerr
	}
	return assembleBundles(ctx, deps, in, provider)
}

func appendVisitorTurn(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) error {
	if _, werr := deps.Conv.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID, Role: "visitor", Body: in.Body,
	}); werr != nil {
		return fmt.Errorf("append visitor message: %w", werr)
	}
	return nil
}

func assembleBundles(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
	provider inference.Provider,
) (sendPrep, error) {
	retr, lerr := buildRetriever(ctx, deps, &retrieverBuildInput{
		ownerID: in.OwnerID, snapshot: in.RoleSnapshot,
	})
	if lerr != nil {
		return sendPrep{}, lerr
	}
	skills := buildSkillBundle(ctx, deps, in)
	booker, berr := buildBookerBundle(ctx, deps, in)
	if berr != nil {
		return sendPrep{}, berr
	}
	return sendPrep{
		provider: provider, retr: retr, skills: skills,
		extMCP: buildExternalMCPBundle(ctx, deps, in),
		booker: booker,
	}, nil
}

// preflightSend —— body 非空 + turn quota + resolver。
func preflightSend(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (inference.Provider, error) {
	if in.Body == "" {
		return nil, ErrEmptyField
	}
	if qerr := enforceTurnQuota(ctx, deps, in); qerr != nil {
		return nil, qerr
	}
	provider, perr := deps.Resolver.Resolve(ctx, &inference.ResolveInput{
		OwnerID: in.OwnerID,
		Mode:    in.Mode,
		BYOAI:   in.BYOAI,
	})
	if perr != nil {
		return nil, fmt.Errorf("resolve provider: %w", perr)
	}
	return provider, nil
}

// enforceTurnQuota —— 在写访客 message 之前检查 conversation 状态 +
// turns/session。conversation 已 ended (/summary 写过) → 拒。
func enforceTurnQuota(ctx context.Context, deps *VisitorDeps, in *SendMessageInput) error {
	conv, err := deps.Conv.GetConversation(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return fmt.Errorf("load conv for quota: %w", err)
	}
	if conv.EndedAt != nil {
		return domain.ErrConversationEnded
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
	ctx context.Context, deps *VisitorDeps, code *domain.AccessCode, convID string,
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

// retrieverBuildInput —— buildRetriever 入参 (owner_id + 必填 snapshot)。
type retrieverBuildInput struct {
	snapshot *domain.RoleSnapshot
	ownerID  string
}

// buildRetriever —— 加载 wiki + output + posts 给 tool executor 用。retrieval
// 阶段不做 ACL 过滤——ACL 由 tool 内部按调用时的 URI 评估（search 结果过滤、
// read 直接拒）。这样 ACL deny 也会被 AI "看到"为"找不到"，而不是"corpus
// 里没有"。
//
// ACL 走 [[role_snapshot]].AllowsCorpus —— A.3-IAM-5 起每个 session 必有
// snapshot（code 走 assumed_role_id；public/byoai 走 owner vanilla）。
//
// posts 只拉已 published 的；草稿不进 visitor 视野。
func buildRetriever(
	ctx context.Context, deps *VisitorDeps, in *retrieverBuildInput,
) (*retriever, error) {
	wikis, werr := deps.Wiki.ListByOwner(ctx, in.ownerID, maxRAGWikis)
	if werr != nil {
		return nil, fmt.Errorf("list wiki for retrieval: %w", werr)
	}
	outputs, oerr := deps.Output.ListByOwner(ctx, in.ownerID, maxRAGOutputs)
	if oerr != nil {
		return nil, fmt.Errorf("list output for retrieval: %w", oerr)
	}
	writings := listWritingsForRetrieval(ctx, deps, in.ownerID)
	return newRetriever(&retrieverInput{
		wikis: wikis, outputs: outputs, writings: writings,
		snapshot: in.snapshot,
	}), nil
}

func listWritingsForRetrieval(
	ctx context.Context, deps *VisitorDeps, ownerID string,
) []domain.Writing {
	if deps.Writings == nil {
		return []domain.Writing{}
	}
	writings, err := deps.Writings.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return []domain.Writing{}
	}
	return writings
}

// streamReply / buildChatRequest / makeChatExecutor / pumpChunks 拆到
// visitor_chat_stream.go，守 350-line cap。

// doneInput —— emitDoneEvent 入参打包；revive argument-limit ≤ 5。
type doneInput struct {
	deps *VisitorDeps
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
