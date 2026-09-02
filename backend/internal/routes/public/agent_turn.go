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

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
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
	// defer is a **fallback**, not the normal path: normally the slot releases the moment
	// `done` fires (TurnEnded). release is idempotent, calling from both paths is safe (F-A-42).
	defer release()
	dispatchTurn(h, w, r, turnSlot{auth: auth, release: release}, req)
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

// buildGhostForTurn —— turn-epilogue port (ghost-steering) injected into inference. After
// done, produces at most one steering ghost from this turn's last reply, wrapped in the
// generic EpilogueFrame{Kind:"ghost"}. Wired only in code mode + frozen waypoints + a
// conversation (nil otherwise); inference doesn't know "ghost", it just emits by Kind.
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

// ghostRun —— ghost-policy context for one code session (closes over handler + session
// + cred + conv).
type ghostRun struct {
	h      *Handlers
	cred   *inference.Cred
	auth   authedVisitor
	convID string
}

// run —— produce a candidate (silence/failure → nil) → persist to conversation_ghosts →
// Kind="ghost" frame.
func (gr *ghostRun) run(ctx context.Context, lastMsg string) *inference.EpilogueFrame {
	cand := gr.candidate(ctx, lastMsg)
	if cand == nil {
		return nil
	}
	return gr.persist(ctx, cand)
}

// candidate —— check unvisited (empty → silence, no LLM call) → GhostPolicy (owner's single
// model) → parse. Silence/failure/invalid → nil.
func (gr *ghostRun) candidate(ctx context.Context, lastMsg string) *conversation.GhostCandidate {
	// F-A-10: unvisited waypoints, filtered by role/code "evidence required" to drop
	// non-terminal waypoints with no evidence (terminal waypoints kept).
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

// buildAgentTurnLedger —— ghost-steering ledger port injected into inference. At turn end,
// resolves this turn's citations + booking hits into waypoint-visited and stores it back to
// the session. Wired only in code mode with frozen waypoints (nil otherwise, inference skips
// it). best-effort: a marking failure only warns, never suppresses this turn's reply.
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

// terminalToolHit —— the ledger's "terminal hit" signal: did this turn's successful tools
// include one that ran a terminal capability. The capability is external (booking =
// calendar_book); inference only reports the tool name, so this call is made here.
func terminalToolHit(successfulTools []string) bool {
	return slices.Contains(successfulTools, "calendar_book")
}

func hasFrozenWaypoints(auth authedVisitor) bool {
	if auth.Data.Mode != "code" || auth.Data.RoleSnapshot == nil {
		return false
	}
	return len(auth.Data.RoleSnapshot.Waypoints()) > 0
}

// ownerTZForTurn —— the owner's profile timezone, injected into the generic instruction's
// "what time is it now" context. fail-open (unreadable → empty, inference falls back to UTC).
func ownerTZForTurn(r *http.Request, h *Handlers, ownerID string) string {
	ownerRow, err := h.Visitor.Owners.GetByID(r.Context(), ownerID)
	if err != nil {
		h.Log.Warn("owner tz for turn", "err", err)
		return ""
	}
	return ownerRow.ProfileTimezone
}

// buildCrossConvForTurn —— "cross-conversation awareness": before the turn, computes a
// digest of this member's other conversations to inject into the instruction. No member
// (public/byoai) or no conv → empty. fail-open (warn + empty on failure).
func buildCrossConvForTurn(
	r *http.Request, h *Handlers, auth authedVisitor, convID string,
) string {
	if auth.Data.MemberID == "" || convID == "" {
		return ""
	}
	return crossConvDigestOrEmpty(r, h, auth.Data.MemberID, convID)
}

func crossConvDigestOrEmpty(r *http.Request, h *Handlers, memberID, convID string) string {
	digest, err := conversation.BuildCrossConvDigest(r.Context(), &h.Visitor, memberID, convID)
	if err != nil {
		h.Log.Warn("build cross-conv digest", "err", err)
		return ""
	}
	return digest
}

// buildAgentTurnPersist —— the persistence port injected into inference. Routes the
// backend's accumulated TurnResult through RecordDialog into the conversation table (cited
// ids → Citation VO, both message rows written atomically). Empty convID → nil (no persist).
// ctx is passed in by inference (detached — survives a client disconnect).
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

// buildAgentTurnUsage —— #106 billing: usage port injected into inference. At the end of an
// owner-key turn, records accumulated tokens into inference_usage (scoped to owner_id).
// BYOAI is visitor-paid, so it returns nil. best-effort: a recording failure only warns.
func buildAgentTurnUsage(h *Handlers, auth authedVisitor) inference.RecordUsageFunc {
	if !usageBillable(h, auth) {
		return nil
	}
	rec := turnUsageRecorder{
		h: h, ownerID: auth.Data.OwnerID, providerID: auth.Data.ProviderID,
		// metered —— counts against some gas tank only if both switches are on: the role
		// has a tank attached and this turn resolves to a provider. Also gates cleanup
		// sweep-away — clear a metered row too early and the gas grows back on its own.
		metered: auth.Data.GasMetered && auth.Data.ProviderID != "",
	}
	return rec.record
}

// turnUsageRecorder —— the handful of things a turn's billing needs to close over (whose
// it is, which tank, and whether it counts as gas spend).
type turnUsageRecorder struct {
	h          *Handlers
	ownerID    string
	providerID string
	metered    bool
}

func (u turnUsageRecorder) record(ctx context.Context, usage *inference.TurnUsage) {
	if err := u.h.Usage.Record(ctx, &stats.UsageRow{
		OwnerID: u.ownerID, Model: usage.Model, ProviderID: u.providerID,
		InputTokens: usage.In, OutputTokens: usage.Out, CachedTokens: usage.Cached,
		Metered: u.metered,
	}); err != nil {
		u.h.Log.Warn("record inference usage", "err", err)
	}
}

// usageBillable —— #106: only owner-key turns are billed (BYOAI is visitor-paid / not
// billed when there's no recorder).
func usageBillable(h *Handlers, auth authedVisitor) bool {
	return h.Usage != nil && auth.Data.Mode != "byoai"
}

// visitorToolset —— the packaged return of collectVisitorTools, to stay under revive's
// func-result max=2 limit. bindings is only for the handler's defer close; inference
// doesn't take it. Field order follows govet fieldalignment: maps (8 ptr bytes) first,
// slices after.
type visitorToolset struct {
	Labels         map[string]string
	ReturnDirectly map[string]bool
	Bindings       []*capreg.Binding
	Tools          []tool.BaseTool
	// ClaimGates —— the "said it, must do it" conditions assembled for this turn, passed
	// through as-is (F-A-37).
	ClaimGates []inference.ClaimGate
	// SessionNotes —— facts that only became true after the session started (quota ran
	// out). The visitor's system prompt is frozen when the session is issued, so this is
	// the only channel these facts can get in through (F-B-14).
	SessionNotes []string
}

func resolveAgentTurnCred(
	r *http.Request, h *Handlers, auth authedVisitor,
) (*inference.Cred, error) {
	byoai := pickAgentTurnBYOAICred(h, auth, r)
	return h.Resolver.Resolve(r.Context(), &inference.ResolveInput{
		OwnerID: auth.Data.OwnerID, Mode: auth.Data.Mode, Visitor: byoai,
		// which entry in the book this turn uses — decided and frozen in at session-issue
		// time by "code > role > default".
		ProviderID: auth.Data.ProviderID,
	})
}

func pickAgentTurnBYOAICred(
	h *Handlers, auth authedVisitor, r *http.Request,
) *inference.VisitorCred {
	if auth.Data.Mode != "byoai" {
		return nil
	}
	return readBYOAICredFromHeaders(h, &nopResponseWriter{}, r, auth.Token)
}

// collectVisitorTools —— assembles every visitor binding for this session, flattened into
// the eino tool set + a name → progress_label table (via capreg.FlattenBindings; flattening
// lives in the capreg package so this handler stays under the routes-cyclo ≤ 3 budget).
// Returns visitorToolset to stay under revive's func-result max=2 limit; Bindings is only
// for the handler's defer close, inference doesn't take it. convID threads through to
// AssembleInput.ConversationID so downstream tools (calendar_book / persist) can find the
// conversation row; an empty conv_id makes BookMeeting's parseUUID fail (H.10 regression).
func collectVisitorTools(
	ctx context.Context, h *Handlers, auth authedVisitor, convID string,
) *visitorToolset {
	in := assembleInputFromSession(auth.Data, convID)
	bindings := h.Visitor.AgentSkills.AssembleVisitor(ctx, in)
	fr := capreg.FlattenBindings(bindings)
	return &visitorToolset{
		Bindings: bindings, Tools: fr.Tools,
		Labels: fr.Labels, ReturnDirectly: fr.ReturnDirectly,
		ClaimGates:   turnClaimGates(fr.ClaimGates),
		SessionNotes: h.Visitor.AgentSkills.SessionNotes(ctx, in),
	}
}

// turnClaimGates —— assembly-side declarations → this turn's required conditions. Both
// sides are the same data, split across two boundaries: the assembly side states "what
// this capability declares", the kernel only asks "does this turn satisfy it".
func turnClaimGates(gates []capreg.ClaimGate) []inference.ClaimGate {
	out := make([]inference.ClaimGate, 0, len(gates))
	for i := range gates {
		out = append(out, inference.ClaimGate{
			Tool: gates[i].Tool, Phrases: gates[i].Phrases,
		})
	}
	return out
}
