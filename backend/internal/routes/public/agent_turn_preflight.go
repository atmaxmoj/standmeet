// agent_turn_preflight.go —— whether this turn is allowed to proceed.
//
// Three gates, in a deliberate order: first ask whether this conversation is yours
// (authorization), then ask about the gas tank (#7), and last ask about turn count.
// All of this happens **before any write**, so a blocked turn leaves no partial record
// behind and consumes no quota.
//
// Split out of agent_turn.go: that file owns "how this turn runs", this file owns
// "whether this turn may run" — and the same ownership rule for the /sessions/{id}/... routes
// (the tool route, the ghost log), which name a conversation the same way.

package public

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// visitorToolResult —— what of a tool result the visitor's live stream may carry (F-A-28): no
// raw retrieval text; a citable read keeps only its citation. Injected as ShowToolResult.
var visitorToolResult = conversation.VisitorToolResult

// authOwningConversation —— authenticate the visitor, then require that its session owns the
// conversation named by the URL's {id}. Refusals are written; false = stop.
func authOwningConversation(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (authedVisitor, bool) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return av, false
	}
	return av, h.ownsConversation(w, r, av.Data, chi.URLParam(r, "id"))
}

// ownsConversation —— the conversation id in the URL is the caller's word: a tool runs against it
// (summarize_conversation reads it), ghost records are written to it, so the session must own it.
// A foreign id answers exactly like a missing one. Writes the refusal; false = stop.
func (h *Handlers) ownsConversation(
	w http.ResponseWriter, r *http.Request, data *access.VisitorSessionData, convID string,
) bool {
	acc, err := conversation.ConversationAccessOf(r.Context(), &h.Visitor, data, convID)
	if err != nil {
		h.Log.Error("conversation ownership", "err", err)
		writeError(h.Log, w, serverErr())
		return false
	}
	if acc != conversation.ConvOwned {
		toolRouteRefusals[acc](h, w)
	}
	return acc == conversation.ConvOwned
}

// preflightAgentTurnQuota —— #28: now that persistence moved to /agent/turn, quota is
// also checked here (pre-stream, a clean 4xx, consistent with the old /dialogs). Skipped
// when convID is empty (stateless smoke-test calls). Returns false = an error response
// has already been written, caller backs off.
func preflightAgentTurnQuota(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	// The gas gate runs **before the convID empty-check**: the gas tank is tracked per
	// provider, unrelated to which conversation this turn belongs to. Putting it after
	// would let the first turn of every new conversation bypass it — a gate that can
	// always be sidestepped.
	// (The ownership and turn-count gates genuinely need a conversation to mean anything:
	// no conv means no ownership to check and no turn count to count.)
	if !enforceGasQuotaOrWrite(r, h, auth, w) {
		return false
	}
	if convID == "" {
		return true
	}
	// One gate per line. Order is priority, and it reads that way.
	return allPass([]gate{
		func() bool { return checkConvOwnership(r, h, auth, w, convID) },
		func() bool { return enforceTurnQuotaOrWrite(r, h, auth, w, convID) },
		func() bool { return enforceCodePeriodOrWrite(r, h, auth, w) },
	})
}

// enforceCodePeriodOrWrite —— the per-code per-period rate gate (embed plan, 2026-09-01).
// Only a **code** with a period gate attached goes through the query; one without never
// issues a single query. Shared by code (regardless of session/visitor) — so it keys off
// CodeID only, never convID: a public embed code gets used across many visitors/sessions,
// and what's limited is that code's total volume per period.
func enforceCodePeriodOrWrite(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter,
) bool {
	if h.Visitor.Codes == nil {
		return true // tests may not wire Codes; production always does
	}
	// CheckPeriodLimit internally handles an empty codeID (public/byoai sessions) +
	// checks the quota, returning an error handleVisitorErr can pass straight through
	// (ErrPeriodLimitReached → 403). The multi-condition logic lives in the repo, not here.
	if err := h.Visitor.Codes.CheckPeriodLimit(r.Context(), auth.Data.CodeID); err != nil {
		handleVisitorErr(h.Log, w, err)
		return false
	}
	return true
}

// gate —— one admission check: passing returns true; whichever gate blocks has already
// written its own response.
type gate func() bool

func allPass(gates []gate) bool {
	for _, g := range gates {
		if !g() {
			return false
		}
	}
	return true
}

// enforceGasQuotaOrWrite —— #7 gas gauge. Only a session with a gauge attached reaches
// the query; one without never issues a single query, exactly the same path as today.
// Placed alongside the turn quota because they're two dimensions of the same thing.
func enforceGasQuotaOrWrite(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter,
) bool {
	// byoai spends the visitor's own money, it never touches the owner's gas tank.
	if auth.Data.Mode == "byoai" {
		return true
	}
	gerr := conversation.EnforceGasQuota(r.Context(), &h.Visitor, &conversation.GasQuotaInput{
		OwnerID: auth.Data.OwnerID, ProviderID: auth.Data.ProviderID,
		Metered: auth.Data.GasMetered,
	})
	if gerr != nil {
		handleVisitorErr(h.Log, w, gerr)
		return false
	}
	return true
}

func enforceTurnQuotaOrWrite(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	qerr := conversation.EnforceTurnQuota(r.Context(), &h.Visitor,
		&conversation.TurnQuotaInput{OwnerID: auth.Data.OwnerID, ConversationID: convID})
	if qerr != nil {
		handleVisitorErr(h.Log, w, qerr)
		return false
	}
	return true
}

// checkConvOwnership —— conversation_id is sent by the client, so verify the session owns it
// (conversation.SessionOwnsConversation: a code member's conversations, or the one a codeless
// session was issued with), guarding against borrowing someone else's id to send a turn.
func checkConvOwnership(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	acc, err := conversation.ConversationAccessOf(r.Context(), &h.Visitor, auth.Data, convID)
	if err != nil {
		h.Log.Error("conv ownership check", "err", err)
		writeError(h.Log, w, serverErr())
		return false
	}
	if acc != conversation.ConvOwned {
		writeError(h.Log, w, turnRefusals[acc])
	}
	return acc == conversation.ConvOwned
}

// turnRefusals —— the agent turn's answer when the session does not own the conversation. A
// session that ended (ConvSessionEnded: issued before ownership was recorded) gets a 401: the SDK
// settles a dead session and asks the question again on a fresh one (agent-core
// SESSION_GONE_CODE). A 403 carrying a JSON sentence would be shown to the visitor as the answer —
// right for someone naming another's conversation, wrong for a visitor whose tab outlived a deploy.
var turnRefusals = map[conversation.ConvAccess]apierr.Envelope{
	conversation.ConvSessionEnded: unauthorizedEnv("this chat session has ended — start a new one"),
	conversation.ConvForeign:      forbiddenEnv("this conversation isn't available"),
}

// toolRouteRefusals —— the same two refusals on the /sessions/{id}/... routes; a foreign id answers
// exactly like a missing one.
var toolRouteRefusals = map[conversation.ConvAccess]func(h *Handlers, w http.ResponseWriter){
	conversation.ConvSessionEnded: func(h *Handlers, w http.ResponseWriter) {
		writeError(h.Log, w, turnRefusals[conversation.ConvSessionEnded])
	},
	conversation.ConvForeign: func(h *Handlers, w http.ResponseWriter) {
		writeToolErr(h.Log, w, toolErr{
			Status: http.StatusNotFound, Reason: "conversation_not_found",
			Detail: "conversation not found",
		})
	},
}
