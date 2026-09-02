// history.go —— GET /api/v1/conversations/{id}
//
// Finds the member's open chat by session token, and returns the whole session
// aggregate (session + code + conversation, three separate blocks, never mixed
// together). The frontend hydrates in one shot on load. Scope is locked by the token,
// the URL {id} exists only for RESTful shape.
//
// No conversation held yet → conversation.dialogs is an empty array. Timestamps are
// produced server-side (RFC3339).

package public

import (
	"encoding/json"
	"net/http"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

type ghostResp struct {
	Text     string `json:"text"`
	Selected bool   `json:"selected"`
}

type citationResp struct {
	Genre string `json:"genre"`
	Path  string `json:"path"`
	Title string `json:"title"`
}

type dialogResp struct {
	CreatedAt string          `json:"created_at"`
	Question  string          `json:"question"`
	Answer    string          `json:"answer"`
	Ghosts    []ghostResp     `json:"ghosts"`
	Citations []citationResp  `json:"citations"`
	ToolCalls json.RawMessage `json:"tool_calls"`
}

type conversationResp struct {
	StartedAt string       `json:"started_at"`
	Dialogs   []dialogResp `json:"dialogs"`
	// Events —— things that happened in this conversation (a cancel on the card / a
	// confirmation email sent). After a refresh, the frontend folds these back into the
	// message string the model sees, otherwise reopening the page leaves the agent
	// unaware of them again (F-B-9).
	Events []eventResp `json:"events"`
}

type eventResp struct {
	CreatedAt string `json:"created_at"`
	Text      string `json:"text"`
}

func toEventResps(es []conversation.ConvEvent) []eventResp {
	out := make([]eventResp, 0, len(es))
	for i := range es {
		out = append(out, eventResp{
			CreatedAt: es[i].CreatedAt.Format(time.RFC3339), Text: es[i].Text,
		})
	}
	return out
}

type codeResp struct {
	MaxTurnsPerSession int32 `json:"max_turns_per_session"`
	MaxMembers         int32 `json:"max_members"`
	MemberCount        int   `json:"member_count"`
}

type sessionResp struct {
	VisitorName string   `json:"visitor_name"`
	Code        codeResp `json:"code"`
	UsedTurns   int32    `json:"used_turns"`
}

type viewResp struct {
	Conversation conversationResp `json:"conversation"`
	Session      sessionResp      `json:"session"`
}

func (h *Handlers) getConversation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		writeConversation(h, w, r, av.Data)
	}
}

func writeConversation(
	h *Handlers, w http.ResponseWriter, r *http.Request, data *access.VisitorSessionData,
) {
	view, err := conversation.LoadVisitorView(r.Context(), h.Visitor.History(), data)
	if err != nil {
		h.Log.Error("load conversation", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(toViewResp(&view)); eerr != nil {
		h.Log.Error("encode conversation", "err", eerr)
	}
}

func toViewResp(v *conversation.VisitorView) viewResp {
	return viewResp{
		Session: sessionResp{
			VisitorName: v.Session.VisitorName,
			UsedTurns:   v.Session.UsedTurns,
			Code: codeResp{
				MaxTurnsPerSession: v.Session.Code.MaxTurnsPerSession,
				MaxMembers:         v.Session.Code.MaxMembers,
				MemberCount:        v.Session.Code.MemberCount,
			},
		},
		Conversation: toConversationResp(&v.Conversation),
	}
}

func toConversationResp(c *conversation.Conversation) conversationResp {
	return conversationResp{
		StartedAt: c.StartedAt.Format(time.RFC3339),
		Dialogs:   toDialogResps(c.Dialogs),
		Events:    toEventResps(c.Events),
	}
}

func toDialogResps(ds []conversation.ConvDialog) []dialogResp {
	out := make([]dialogResp, len(ds))
	for i := range ds {
		out[i] = dialogResp{
			CreatedAt: ds[i].CreatedAt.Format(time.RFC3339),
			Question:  ds[i].Question,
			Answer:    ds[i].Answer,
			Ghosts:    toGhostResps(ds[i].Ghosts),
			Citations: toCitationResps(ds[i].Citations),
			// F-A-28: a retrieval call's result is never sent down to the visitor — it
			// contains the note body, including private ones.
			ToolCalls: conversation.VisitorToolCalls(ds[i].ToolCalls),
		}
	}
	return out
}

func toGhostResps(gs []conversation.DialogGhost) []ghostResp {
	out := make([]ghostResp, len(gs))
	for i := range gs {
		out[i] = ghostResp{Text: gs[i].Text, Selected: gs[i].Selected}
	}
	return out
}

func toCitationResps(cs []conversation.DialogCitation) []citationResp {
	out := make([]citationResp, len(cs))
	for i := range cs {
		out[i] = citationResp{Genre: cs[i].Genre, Path: cs[i].Path, Title: cs[i].Title}
	}
	return out
}

// An empty tool_calls → `[]` is already handled by VisitorToolCalls (the frontend
// needs a valid array, not null), so there's no separate rawOrEmptyArray here anymore.
