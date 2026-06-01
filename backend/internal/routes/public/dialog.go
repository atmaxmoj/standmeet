// dialog.go —— POST /api/v1/sessions/{id}/dialogs
//
// D-5 把 visitor chat 切到 browser pi-agent-core 后，/inference/stream 是 raw
// LLM forwarder 不写 messages 表，admin /conversations transcript 一直空。
// frontend 在 turn 完成后 fire-and-forget 调一次，记一个 Dialog (问 + 答
// + cited paths) 到 transcript。底层落两条 messages。
//
// Auth: Bearer visitor session token (跟 /messages / /inference/stream 同套)。
// Body:
//
//	{
//	  "question": "...",
//	  "answer":   "...",
//	  "cited_wiki_paths":   ["path1", "path2"],
//	  "cited_output_paths": ["pathA"]
//	}
//
// Response: 204 No Content (成功) / 4xx (auth / parse) / 5xx (DB)。
// 真正写表 + path 解析在 usecases.RecordDialog (避开 routes-cyclo)。

package public

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/usecases"
)

type dialogRequest struct {
	Question         string   `json:"question"`
	Answer           string   `json:"answer"`
	CitedWikiPaths   []string `json:"cited_wiki_paths"`
	CitedOutputPaths []string `json:"cited_output_paths"`
}

func (h *Handlers) postDialog() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchPostDialog(h, w, r)
	}
}

func dispatchPostDialog(h *Handlers, w http.ResponseWriter, r *http.Request) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return
	}
	req, ok := decodeDialog(h, w, r)
	if !ok {
		return
	}
	runRecordAndRespond(h, w, r, av.Data.OwnerID, req)
}

func runRecordAndRespond(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	ownerID string, req *dialogRequest,
) {
	if perr := usecases.RecordDialog(r.Context(),
		&usecases.DialogDeps{Chats: h.Visitor.Chats, Corpus: h.Corpus, Log: h.Log},
		&usecases.RecordDialogInput{
			OwnerID:          ownerID,
			ConversationID:   chi.URLParam(r, "id"),
			Question:         req.Question,
			Answer:           req.Answer,
			CitedWikiPaths:   req.CitedWikiPaths,
			CitedOutputPaths: req.CitedOutputPaths,
		},
	); perr != nil {
		h.Log.Error("record dialog", "err", perr)
		writeError(h.Log, w, dialogServerErr())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeDialog(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (*dialogRequest, bool) {
	var req dialogRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return nil, false
	}
	if req.Question == "" {
		writeError(h.Log, w, envBadReq("question is required"))
		return nil, false
	}
	return &req, true
}

func dialogServerErr() apierr.Envelope {
	return apierr.Envelope{
		Status:  http.StatusInternalServerError,
		Code:    "server_error",
		Message: "internal error",
	}
}
