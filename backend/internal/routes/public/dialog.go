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
//	  "cited_wiki_ids":   ["<wiki-uuid>", ...],
//	  "cited_output_ids": ["<output-uuid>"]
//	}
//
// Response: 204 No Content (成功) / 4xx (auth / parse) / 5xx (DB)。
// 真正写表 + cited id 反查在 usecases.RecordDialog (避开 routes-cyclo)。

package public

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

type dialogRequest struct {
	Question       string          `json:"question"`
	Answer         string          `json:"answer"`
	CitedWikiIDs   []string        `json:"cited_wiki_ids"`
	CitedOutputIDs []string        `json:"cited_output_ids"`
	ToolCalls      json.RawMessage `json:"tool_calls"`
}

func (h *Handlers) postDialog() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchPostDialog(h, w, r)
	}
}

func dispatchPostDialog(h *Handlers, w http.ResponseWriter, r *http.Request) {
	args, ok := prepareDialogPreflight(h, w, r)
	if !ok {
		return
	}
	if !preflightDialogQuota(r, h, args.OwnerID, args.ConvID, w) {
		return
	}
	runRecordAndRespond(r, h, w, &recordArgs{
		OwnerID: args.OwnerID, ConvID: args.ConvID, Req: args.Req,
	})
}

type dialogPreflightArgs struct {
	Req     *dialogRequest
	OwnerID string
	ConvID  string
}

func prepareDialogPreflight(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (*dialogPreflightArgs, bool) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return nil, false
	}
	req, ok := decodeDialog(h, w, r)
	if !ok {
		return nil, false
	}
	return &dialogPreflightArgs{
		Req: req, OwnerID: av.Data.OwnerID, ConvID: chi.URLParam(r, "id"),
	}, true
}

func preflightDialogQuota(
	r *http.Request, h *Handlers, ownerID, convID string, w http.ResponseWriter,
) bool {
	qerr := usecases.EnforceTurnQuota(r.Context(), &h.Visitor,
		&usecases.TurnQuotaInput{OwnerID: ownerID, ConversationID: convID})
	if qerr != nil {
		handleVisitorErr(h.Log, w, qerr)
		return false
	}
	return true
}

type recordArgs struct {
	Req     *dialogRequest
	OwnerID string
	ConvID  string
}

func runRecordAndRespond(
	r *http.Request, h *Handlers, w http.ResponseWriter, args *recordArgs,
) {
	if perr := usecases.RecordDialog(r.Context(),
		&usecases.DialogDeps{Chats: h.Visitor.Chats, Corpus: h.Corpus, Log: h.Log},
		&usecases.RecordDialogInput{
			OwnerID:        args.OwnerID,
			ConversationID: args.ConvID,
			Question:       args.Req.Question,
			Answer:         args.Req.Answer,
			CitedWikiIDs:   args.Req.CitedWikiIDs,
			CitedOutputIDs: args.Req.CitedOutputIDs,
			ToolCalls:      args.Req.ToolCalls,
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
