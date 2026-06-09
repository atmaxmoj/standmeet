// history.go —— GET /api/v1/sessions/history
//
// visitor 刷新页面后,前端 chat 是纯内存、会空掉。这条让前端载入时按 session
// token 拉回自己这段对话的 Q&A,重建 transcript。
//
// Auth: Bearer visitor session token。会话定位走 session 的 member → 该 member
// 的 open chat(不信 URL,只看 token),所以访客只能看到自己那段。
//
// Response: 200 {"dialogs":[{"question","answer"}, ...]}。还没开过会(无 open
// chat)→ 空数组。citation 暂不带(restore 先保 Q&A 文本;refs hydration 留后续)。

package public

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

type historyDialog struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type historyResponse struct {
	Dialogs []historyDialog `json:"dialogs"`
}

func (h *Handlers) getHistory() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		writeHistory(h, w, r, av.Data)
	}
}

func writeHistory(
	h *Handlers, w http.ResponseWriter, r *http.Request, data *session.VisitorSessionData,
) {
	dialogs, err := usecases.VisitorHistory(
		r.Context(), h.Visitor.Chats, data.MemberID, data.OwnerID,
	)
	if err != nil {
		h.Log.Error("load visitor history", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(toHistoryResponse(dialogs)); eerr != nil {
		h.Log.Error("encode visitor history", "err", eerr)
	}
}

func toHistoryResponse(ds []usecases.VisitorDialog) historyResponse {
	out := make([]historyDialog, len(ds))
	for i := range ds {
		out[i] = historyDialog{Question: ds[i].Question, Answer: ds[i].Answer}
	}
	return historyResponse{Dialogs: out}
}
