// agent_turn.go —— POST /api/v1/agent/turn
//
// H.9: visitor agent loop 搬 backend，走 eino ADK ChatModelAgent。
// Handler 的 4 件事：
//   1. visitor session 鉴权
//   2. 解 body (system + user_message + history)
//   3. 装配 visitor capability bindings → 抽 []tool.BaseTool 喂 ADK
//   4. 调 inference.RunAgentTurn 让它跑 + 流 pi-style SSE
//
// 跟 /llm/chat/stream 并存：H.9.a 起 /llm/chat/stream 仍可用 (浏览器旧
// pi-agent-core 还在用)；H.10 切完 SDK 之后 /llm/chat/stream 才会废弃。

package public

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/cloudwego/eino/components/tool"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func (h *Handlers) agentTurn() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		var req inference.AgentTurnRequest
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runAgentTurn(h, w, r, auth, &req)
	}
}

func runAgentTurn(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	auth authedVisitor, req *inference.AgentTurnRequest,
) {
	cred, cerr := resolveAgentTurnCred(r, h, auth)
	if cerr != nil {
		writeLLMPreStreamErr(h, w, cerr)
		return
	}
	if !preflightAgentTurnQuota(r, h, auth, w, req.ConversationID) {
		return
	}
	ts := collectVisitorTools(r.Context(), h, auth, req.ConversationID)
	defer closeBindings(ts.Bindings)
	inference.RunAgentTurn(r.Context(), h.Log, w, &inference.AgentTurnInput{
		Cred: cred, Req: req,
		Tools:            ts.Tools,
		ProgressLabels:   ts.Labels,
		ReturnDirectly:   ts.ReturnDirectly,
		Mode:             auth.Data.Mode,
		Persist:          buildAgentTurnPersist(h, auth, req.ConversationID),
		CrossConvContext: buildCrossConvForTurn(r, h, auth, req.ConversationID),
		OwnerTimezone:    ownerTZForTurn(r, h, auth.Data.OwnerID),
		VisitorTimezone:  req.VisitorTimezone,
	})
}

// ownerTZForTurn —— owner 的 profile timezone,注入通用 instruction 的"现在
// 几点/在哪个时区"。fail-open(读不到 → 空,inference 退 UTC),不为了上下文把这轮
// 答崩。
func ownerTZForTurn(r *http.Request, h *Handlers, ownerID string) string {
	owner, err := h.Visitor.Owners.GetByID(r.Context(), ownerID)
	if err != nil {
		h.Log.Warn("owner tz for turn", "err", err)
		return ""
	}
	return owner.ProfileTimezone
}

// buildCrossConvForTurn —— 「互通」:turn 前算好该 member 其他对话的 digest 注入
// instruction。无 member(public/byoai)/ 无 conv → 空。失败 fail-open(warn + 空,
// 不为了上下文把这轮答崩)。
func buildCrossConvForTurn(
	r *http.Request, h *Handlers, auth authedVisitor, convID string,
) string {
	if auth.Data.MemberID == "" || convID == "" {
		return ""
	}
	return crossConvDigestOrEmpty(r, h, auth.Data.MemberID, convID)
}

func crossConvDigestOrEmpty(r *http.Request, h *Handlers, memberID, convID string) string {
	digest, err := usecases.BuildCrossConvDigest(r.Context(), &h.Visitor, memberID, convID)
	if err != nil {
		h.Log.Warn("build cross-conv digest", "err", err)
		return ""
	}
	return digest
}

// preflightAgentTurnQuota —— #28: 落库挪到 /agent/turn 后,配额也在这查
// (pre-stream,清晰 4xx,跟原 /dialogs 一致)。检查 conversation 状态 +
// turns/session。convID 空(无状态 smoke 调用)跳过。返 false = 已写错误响应、
// caller 收手。
func preflightAgentTurnQuota(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	if convID == "" {
		return true
	}
	if !checkConvOwnership(r, h, auth, w, convID) {
		return false
	}
	return enforceTurnQuotaOrWrite(r, h, auth, w, convID)
}

func enforceTurnQuotaOrWrite(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	qerr := usecases.EnforceTurnQuota(r.Context(), &h.Visitor,
		&usecases.TurnQuotaInput{OwnerID: auth.Data.OwnerID, ConversationID: convID})
	if qerr != nil {
		handleVisitorErr(h.Log, w, qerr)
		return false
	}
	return true
}

// checkConvOwnership —— 多对话模型:code 访客可有多段对话且 conversation_id 由
// 客户端传,必须校验这段属于该 member,防借别人的 id 发 turn。无 member(public/
// byoai)没 member 可比对,沿用既有信任(conversation 由 owner-scoped session 锁)。
func checkConvOwnership(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	if auth.Data.MemberID == "" {
		return true
	}
	return verifyConvMember(r, h, auth, w, convID)
}

func verifyConvMember(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	ok, err := usecases.ChatBelongsToMember(
		r.Context(), &h.Visitor, auth.Data.OwnerID, convID, auth.Data.MemberID)
	if err != nil {
		h.Log.Error("conv ownership check", "err", err)
		writeError(h.Log, w, serverErr())
		return false
	}
	if !ok {
		writeError(h.Log, w, forbiddenEnv("conversation does not belong to this session"))
		return false
	}
	return true
}

// buildAgentTurnPersist —— 注入给 inference 的落库 port。把后端累计出的
// TurnResult 走现有 RecordDialog sink 进 conversation 表(cited id → Citation
// VO、两行 messages 原子)。convID 空 → nil(不落)。ctx 由 inference 传(detached,
// 客户端断开也活)。
func buildAgentTurnPersist(
	h *Handlers, auth authedVisitor, convID string,
) inference.PersistFunc {
	if convID == "" {
		return nil
	}
	ownerID := auth.Data.OwnerID
	return func(ctx context.Context, res *inference.TurnResult) error {
		return usecases.RecordDialog(ctx, &usecases.DialogDeps{
			Chats: h.Visitor.Chats, Corpus: h.Corpus, Log: h.Log,
		}, &usecases.RecordDialogInput{
			OwnerID: ownerID, ConversationID: convID,
			Question: res.Question, Answer: res.Answer,
			CitedWikiIDs: res.CitedWikiIDs, CitedOutputIDs: res.CitedOutputIDs,
			ToolCalls: res.ToolCalls,
		})
	}
}

// visitorToolset —— collectVisitorTools 返回打包，避免 revive func-result
// max=2 限制。bindings 仅给 handler defer close 用；inference 不接它。
// 字段顺序按 govet fieldalignment 排：map (8 ptr bytes) 在前，slice 在后。
type visitorToolset struct {
	Labels         map[string]string
	ReturnDirectly map[string]bool
	Bindings       []*capreg.Binding
	Tools          []tool.BaseTool
}

func resolveAgentTurnCred(
	r *http.Request, h *Handlers, auth authedVisitor,
) (*inference.Cred, error) {
	byoai := pickAgentTurnBYOAICred(h, auth, r)
	return h.Resolver.Resolve(r.Context(), &inference.ResolveInput{
		OwnerID: auth.Data.OwnerID, Mode: auth.Data.Mode, BYOAI: byoai,
	})
}

func pickAgentTurnBYOAICred(
	h *Handlers, auth authedVisitor, r *http.Request,
) *domain.AICredential {
	if auth.Data.Mode != "byoai" {
		return nil
	}
	return readBYOAICredFromHeaders(h, &nopResponseWriter{}, r, auth.Token)
}

// collectVisitorTools —— 装配本 session 的所有 visitor binding，拍平成
// eino tool 集合 + name → progress_label 表 (走 capreg.FlattenBindings；
// 拍平逻辑放 capreg 包，让本 handler 守 routes-cyclo ≤ 3)。
//
// 返回 visitorToolset 是为了避开 revive func-result max=2 限制；
// Bindings 字段仅给 handler defer close 用，inference 不接。
//
// convID 透到 AssembleInput.ConversationID 让下游 tool (calendar_book /
// persist) 能找到 conversation 行；空 conv_id 会让 BookMeeting 的
// parseUUID 失败 (H.10 sweep 时踩出的 regression)。
func collectVisitorTools(
	ctx context.Context, h *Handlers, auth authedVisitor, convID string,
) *visitorToolset {
	in := assembleInputFromSession(auth.Data, convID)
	bindings := h.Visitor.AgentSkills.AssembleVisitor(ctx, in)
	fr := capreg.FlattenBindings(bindings)
	return &visitorToolset{
		Bindings: bindings, Tools: fr.Tools,
		Labels: fr.Labels, ReturnDirectly: fr.ReturnDirectly,
	}
}
