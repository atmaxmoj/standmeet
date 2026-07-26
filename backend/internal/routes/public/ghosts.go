// ghosts.go —— POST /api/v1/sessions/{id}/ghosts/shown
//                    POST /api/v1/sessions/{id}/ghosts/{sid}/accept
//
// visitor 浏览器在 ghost text 实际渲到输入框时调一次 shown (拿回 row id)；
// visitor 按 Tab 接受时调 accept (路径里带 row id)。
//
// Auth: Bearer visitor session token，跟 dialogs / summary 一套。
//
// 路径里的 {id} 是 conversation id (URL 风格沿用现有 sessions/{id}/* 习惯)，
// 不是 session token —— route 在解 auth 后校 conv_id 必须等于 session 当前
// 的 conversation_id 防 cross-conv 写入。

package public

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/conversation"
)

type shownRequest struct {
	GhostText string `json:"ghost_text"`
	Source    string `json:"source"`
	TurnIndex int32  `json:"turn_index"`
}

type shownResponse struct {
	ID string `json:"id"`
}

func (h *Handlers) postGhostShown() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchShown(h, w, r)
	}
}

func dispatchShown(h *Handlers, w http.ResponseWriter, r *http.Request) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return
	}
	req, ok := decodeShown(h, w, r)
	if !ok {
		return
	}
	runRecordShown(h, w, r, &shownArgs{av: av, req: req, convID: chi.URLParam(r, "id")})
}

// shownArgs —— runRecordShown 入参 bundle，避开 argument-limit (max 5)。
type shownArgs struct {
	av     authedVisitor
	req    *shownRequest
	convID string
}

func runRecordShown(h *Handlers, w http.ResponseWriter, r *http.Request, a *shownArgs) {
	row, err := conversation.RecordGhostShown(r.Context(), &h.Ghosts,
		&conversation.RecordGhostShownInput{
			OwnerID:        a.av.Data.OwnerID,
			ConversationID: a.convID,
			GhostText:      a.req.GhostText,
			Source:         a.req.Source,
			TurnIndex:      a.req.TurnIndex,
		})
	if err != nil {
		handleGhostErr(h, w, err)
		return
	}
	writeShownResponse(h, w, row.ID)
}

func writeShownResponse(h *Handlers, w http.ResponseWriter, id string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if encErr := json.NewEncoder(w).Encode(shownResponse{ID: id}); encErr != nil {
		h.Log.Error("encode shown response", "err", encErr)
	}
}

func decodeShown(h *Handlers, w http.ResponseWriter, r *http.Request) (*shownRequest, bool) {
	var req shownRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeError(h.Log, w, envBadReq("invalid body"))
		return nil, false
	}
	return &req, true
}

func (h *Handlers) postGhostAccept() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchAccept(h, w, r)
	}
}

func dispatchAccept(h *Handlers, w http.ResponseWriter, r *http.Request) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return
	}
	convID := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "sid")
	_, err := conversation.AcceptGhost(r.Context(), &h.Ghosts, av.Data.OwnerID, convID, sid)
	if err != nil {
		handleGhostErr(h, w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var ghostErrCases = []apierr.Case{
	{Match: conversation.ErrInvalidGhostSource, Envelope: apierr.Envelope{
		Status: http.StatusBadRequest, Code: "bad_request",
		Message: "invalid ghost source",
	}},
	{Match: conversation.ErrGhostNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found",
		Message: "ghost not found",
	}},
	{Match: apierr.ErrEmptyField, Envelope: apierr.Envelope{
		Status: http.StatusBadRequest, Code: "bad_request",
		Message: "missing required field",
	}},
}

func handleGhostErr(h *Handlers, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, ghostErrCases)
	notFound := errors.Is(err, conversation.ErrGhostNotFound)
	if env.Status >= http.StatusInternalServerError || notFound {
		h.Log.Info("ghost flow", "err", err)
	}
	writeError(h.Log, w, env)
}
