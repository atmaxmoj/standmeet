// visitor_conversations.go —— POST /api/v1/conversations
//
// Multi-conversation model: one member can have several conversations (the main chat
// + one for each doc's floating panel). When a floating panel opens it sends doc_key
// along, and the backend finds-or-creates that conversation by (member, doc_key) and
// returns its id + existing dialogs. Idempotent: reopening the same doc returns the
// same conversation, so a refresh can just re-POST to recover it. Only available to
// code visitors (who have a member); missing fields → 400.

package public

import (
	"encoding/json"
	"net/http"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

type openConvRequest struct {
	DocKey string `json:"doc_key"`
}

type openConvResponse struct {
	ConversationID string           `json:"conversation_id"`
	Conversation   conversationResp `json:"conversation"`
}

func (h *Handlers) openDocConversation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		runOpenDocConversation(h, w, r, av)
	}
}

func runOpenDocConversation(h *Handlers, w http.ResponseWriter, r *http.Request, av authedVisitor) {
	var req openConvRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return
	}
	chat, err := conversation.OpenConversationForDoc(r.Context(), &h.Visitor,
		&conversation.OpenConvForDocInput{
			OwnerID: av.Data.OwnerID, CodeID: av.Data.CodeID, MemberID: av.Data.MemberID,
			VisitorName: av.Data.Visitor.Name, Mode: av.Data.Mode, DocKey: req.DocKey,
		})
	if err != nil {
		handleVisitorErr(h.Log, w, err)
		return
	}
	writeOpenConv(h, w, r, &chat)
}

func writeOpenConv(
	h *Handlers, w http.ResponseWriter, r *http.Request, chat *conversation.Chat,
) {
	conv, err := conversation.ForChat(r.Context(), h.Visitor.History(), chat.OwnerID, chat.ID)
	if err != nil {
		h.Log.Error("load doc conversation", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := openConvResponse{ConversationID: chat.ID, Conversation: toConversationResp(&conv)}
	if eerr := json.NewEncoder(w).Encode(resp); eerr != nil {
		h.Log.Error("encode doc conversation", "err", eerr)
	}
}
