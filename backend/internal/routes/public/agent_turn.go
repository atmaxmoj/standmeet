// agent_turn.go —— POST /api/v1/agent/turn. Handler: visitor auth → acquire concurrency slot
// (agent_turn_queue.go) → decode → assemble capability bindings → inference.RunAgentTurn (SSE).
// Coexists with /llm/chat/stream until the SDK cutover (H.10).

package public

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"

	"github.com/cloudwego/eino/components/tool"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/owner"
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
	release, ok := acquireOrReject(h, w, r, auth)
	if !ok {
		return
	}
	defer release()
	dispatchTurn(h, w, r, auth, req)
}

// ghostWire —— the `ghost` epilogue payload (SSE data). Owned by the route (the kernel is
// epilogue-agnostic); json tags == the wire the frontend parses. Mirrors agentcore.GhostFrame.
type ghostWire struct {
	Text           string `json:"text"`
	TargetWaypoint string `json:"target_waypoint"`
	FollowsFrom    string `json:"follows_from"`
	GhostID        string `json:"ghost_id"`
	IsBridge       bool   `json:"is_bridge"`
}

// buildGhostForTurn —— 注入给 inference 的 turn-epilogue port(ghost-steering)。done 之后据本轮末条
// 回复出至多一个 steering ghost，包成通用 EpilogueFrame{Kind:"ghost"}。仅 code 模式 + 冻了 waypoints
// + 有 conversation 才装(否则 nil)。inference 不认识 "ghost"，只按 Kind 发 SSE 事件。
func buildGhostForTurn(
	h *Handlers, auth authedVisitor, cred *inference.Cred, convID string,
) inference.EpilogueFunc {
	if !hasFrozenWaypoints(auth) || convID == "" {
		return nil
	}
	gr := &ghostRun{h: h, auth: auth, cred: cred, convID: convID}
	return func(ctx context.Context, lastMsg string) *inference.EpilogueFrame {
		return gr.run(ctx, lastMsg)
	}
}

// ghostRun —— 一段 code session 的 ghost policy 上下文(闭进 handler + session + cred + conv)。
type ghostRun struct {
	h      *Handlers
	cred   *inference.Cred
	auth   authedVisitor
	convID string
}

// run —— 出候选(silence/失败 → nil)→ 落 conversation_ghosts → Kind="ghost" epilogue frame。
func (gr *ghostRun) run(ctx context.Context, lastMsg string) *inference.EpilogueFrame {
	cand := gr.candidate(ctx, lastMsg)
	if cand == nil {
		return nil
	}
	return gr.persist(ctx, cand)
}

// candidate —— unvisited 检查(空 → silence,不调 LLM)→ GhostPolicy(owner 单模型)→ 解析。
// 沉默/失败/无效 → nil。
func (gr *ghostRun) candidate(ctx context.Context, lastMsg string) *conversation.GhostCandidate {
	// F-A-10: 未访问的 waypoint,并按 role/code 的「需证据」开关剔除空证据的非终点 waypoint(终点保留)。
	unvisited := conversation.SteeringCandidates(
		gr.auth.Data.RoleSnapshot, gr.auth.Data.VisitedWaypoints,
	)
	if len(unvisited) == 0 {
		return nil
	}
	out, err := inference.Generate(ctx, gr.cred, &inference.ChatRequest{
		System: conversation.GhostPolicyPrompt,
		Messages: []inference.ChatRequestMsg{
			{Role: "user", Content: conversation.BuildGhostContext(unvisited, lastMsg)},
		},
	})
	if err != nil {
		gr.h.Log.Warn("ghost policy generate", logErrKey, err)
		return nil
	}
	return conversation.ParseGhost(out)
}

func (gr *ghostRun) persist(
	ctx context.Context, cand *conversation.GhostCandidate,
) *inference.EpilogueFrame {
	id, perr := conversation.RecordPolicyGhost(ctx, gr.h.Ghosts, &conversation.PolicyGhostInput{
		OwnerID: gr.auth.Data.OwnerID, ConversationID: gr.convID,
		Text: cand.Text, TargetWaypoint: cand.TargetWaypoint, FollowsFrom: cand.FollowsFrom,
	})
	if perr != nil {
		gr.h.Log.Warn("ghost policy persist", logErrKey, perr)
		return nil
	}
	payload, merr := json.Marshal(ghostWire{
		Text: cand.Text, TargetWaypoint: cand.TargetWaypoint, FollowsFrom: cand.FollowsFrom,
		GhostID: id, IsBridge: cand.IsBridge,
	})
	if merr != nil {
		gr.h.Log.Warn("ghost policy marshal", logErrKey, merr)
		return nil
	}
	return &inference.EpilogueFrame{Kind: "ghost", Payload: payload}
}

// buildAgentTurnLedger —— 注入给 inference 的 ghost-steering ledger port。turn 收尾把本轮引用
// + booking 命中解析成 waypoint visited,存回 session。仅 code 模式且冻了 waypoints 才装(否则 nil,
// inference 跳过)。best-effort:标记失败只 warn,绝不压这轮答复。
func buildAgentTurnLedger(h *Handlers, auth authedVisitor) inference.MarkWaypointsFunc {
	if !hasFrozenWaypoints(auth) {
		return nil
	}
	return func(ctx context.Context, citedNoteIDs, successfulTools []string) {
		h.Ledger.Mark(ctx, &conversation.MarkWaypointsInput{
			Token: auth.Token, Data: *auth.Data,
			CitedNoteIDs: citedNoteIDs, TerminalOK: terminalToolHit(successfulTools),
		})
	}
}

// terminalToolHit —— ledger 的"终点命中"信号:本轮成功工具里有没有跑成终点能力的工具。终点能力
// 是外置的(booking = calendar_book);inference 只报工具名,这里(route,认得具体能力)判定。
func terminalToolHit(successfulTools []string) bool {
	return slices.Contains(successfulTools, "calendar_book")
}

func hasFrozenWaypoints(auth authedVisitor) bool {
	if auth.Data.Mode != "code" || auth.Data.RoleSnapshot == nil {
		return false
	}
	return len(auth.Data.RoleSnapshot.Waypoints()) > 0
}

// ownerTZForTurn —— owner 的 profile timezone,注入通用 instruction 的"现在
// 几点/在哪个时区"。fail-open(读不到 → 空,inference 退 UTC),不为了上下文把这轮
// 答崩。
func ownerTZForTurn(r *http.Request, h *Handlers, ownerID string) string {
	ownerRow, err := h.Visitor.Owners.GetByID(r.Context(), ownerID)
	if err != nil {
		h.Log.Warn("owner tz for turn", "err", err)
		return ""
	}
	return ownerRow.ProfileTimezone
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
		r.Context(), &h.Visitor, auth.Data.OwnerID, convID, auth.Data.MemberID,
	)
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
		return conversation.RecordDialog(ctx, &conversation.DialogDeps{
			Chats: h.Visitor.Chats, Corpus: h.Corpus,
			Subjectivity: h.Subjectivity, Log: h.Log,
		}, &conversation.RecordDialogInput{
			OwnerID: ownerID, ConversationID: convID,
			Question: res.Question, Answer: res.Answer,
			CitedWikiIDs: res.CitedWikiIDs, CitedWritingIDs: res.CitedWritingIDs,
			CitedOutputIDs:       res.CitedOutputIDs,
			CitedSubjectivityIDs: res.CitedSubjectivityIDs,
			ToolCalls:            res.ToolCalls,
		})
	}
}

// buildAgentTurnUsage —— #106 计费:注入给 inference 的用量 port。owner-key turn 收尾把累计
// token 记进 inference_usage(闭进 owner_id)。BYOAI 是访客自付,返 nil 不计。best-effort:
// 记账失败只 warn,不影响这轮答复。
func buildAgentTurnUsage(h *Handlers, auth authedVisitor) inference.RecordUsageFunc {
	if !usageBillable(h, auth) {
		return nil
	}
	ownerID := auth.Data.OwnerID
	return func(ctx context.Context, model string, in, out int) {
		if err := h.Usage.Record(ctx, ownerID, model, in, out); err != nil {
			h.Log.Warn("record inference usage", "err", err)
		}
	}
}

// usageBillable —— #106: 只对 owner-key turn 计费(BYOAI 访客自付 / 无 recorder 时不计)。
func usageBillable(h *Handlers, auth authedVisitor) bool {
	return h.Usage != nil && auth.Data.Mode != "byoai"
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
) *owner.AICredential {
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
