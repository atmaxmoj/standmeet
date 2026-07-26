// visitor_conversations.go —— POST /api/v1/conversations
//
// 多对话模型:一个 member 可有多段对话(主聊天 + 每篇 doc 浮窗各一段)。浮窗打开
// 时带 doc_key 过来,后端按 (member, doc_key) find-or-create 那段对话并返它的
// id + 已有 dialogs。idempotent:同一 doc 再开还是那段,刷新重 POST 即可恢复。
// 仅 code 访客(有 member)可用;缺字段 → 400。

package public

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/usecases"
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
	chat, err := usecases.OpenConversationForDoc(r.Context(), &h.Visitor,
		&usecases.OpenConvForDocInput{
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
	conv, err := usecases.ConversationForChat(r.Context(), &h.Visitor, chat.OwnerID, chat.ID)
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
