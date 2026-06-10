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

// historyResponse —— 载入时的权威快照:历史 Q&A + 实时配额/身份。前端据此
// reconcile 本地缓存(strip 的 used / max / 名额 / 名字)。后端 conversation +
// code 是唯一 source of truth,免得 desync 出现「没问就 1/50」「session 早没了
// 还显旧名字」这类不一致。
type historyResponse struct {
	VisitorName string          `json:"visitor_name"`
	Dialogs     []historyDialog `json:"dialogs"`
	UsedTurns   int             `json:"used_turns"`
	MemberCount int             `json:"member_count"`
	MaxTurns    int32           `json:"max_turns"`
	MaxMembers  int32           `json:"max_members"`
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
	snap, err := usecases.BuildVisitorSnapshot(r.Context(), &h.Visitor, data)
	if err != nil {
		h.Log.Error("load visitor history", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(toHistoryResponse(&snap)); eerr != nil {
		h.Log.Error("encode visitor history", "err", eerr)
	}
}

func toHistoryResponse(snap *usecases.VisitorSnapshot) historyResponse {
	out := make([]historyDialog, len(snap.Dialogs))
	for i := range snap.Dialogs {
		out[i] = historyDialog{Question: snap.Dialogs[i].Question, Answer: snap.Dialogs[i].Answer}
	}
	return historyResponse{
		Dialogs: out, UsedTurns: snap.UsedTurns,
		MaxTurns: snap.MaxTurns, MaxMembers: snap.MaxMembers,
		MemberCount: snap.MemberCount, VisitorName: snap.VisitorName,
	}
}
