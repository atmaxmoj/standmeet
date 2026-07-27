// history.go —— GET /api/v1/conversations/{id}
//
// 凭 session token 找到 member 的 open chat,返回整个会话聚合(session + code +
// conversation 三块,各占一块不混)。前端载入时一次性 hydrate。范围由 token
// 锁定,URL {id} 仅做 RESTful 形态。
//
// 还没开过会 → conversation.dialogs 空数组。timestamps serverside 出(RFC3339)。

package public

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation"

	"github.com/atmaxmoj/standmeet/internal/infra/session"
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
	h *Handlers, w http.ResponseWriter, r *http.Request, data *session.VisitorSessionData,
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
			ToolCalls: rawOrEmptyArray(ds[i].ToolCalls),
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

// rawOrEmptyArray —— 存的 tool_calls 为空(老 dialog / 没用 tool)→ 回 [],
// 让前端拿到合法数组而不是 null。
func rawOrEmptyArray(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("[]")
	}
	return json.RawMessage(b)
}
