// persist_turn.go —— POST /api/v1/sessions/{id}/turns
//
// D-5 把 visitor chat 切到 browser pi-agent-core 后，/inference/stream 是 raw
// LLM forwarder 不写 messages 表，admin /conversations transcript 一直空。
// 本端给 frontend 在 turn 完成 (finalizeTurn) 后 fire-and-forget 调一次，
// 落 user + assistant 两条 message + cited paths 解析。
//
// Auth: Bearer visitor session token (跟 /messages / /inference/stream 同套)。
// Body:
//
//	{
//	  "user_text": "...",
//	  "assistant_text": "...",
//	  "cited_wiki_paths":   ["path1", "path2"],
//	  "cited_output_paths": ["pathA"]
//	}
//
// Response: 204 No Content (成功) / 4xx (auth / parse) / 5xx (DB)。
// 真正写表 + path 解析在 usecases.PersistVisitorTurn (避开 routes-cyclo)。

package public

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/usecases"
)

type persistTurnRequest struct {
	UserText         string   `json:"user_text"`
	AssistantText    string   `json:"assistant_text"`
	CitedWikiPaths   []string `json:"cited_wiki_paths"`
	CitedOutputPaths []string `json:"cited_output_paths"`
}

func (h *Handlers) postTurn() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchPostTurn(h, w, r)
	}
}

func dispatchPostTurn(h *Handlers, w http.ResponseWriter, r *http.Request) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return
	}
	req, ok := decodePersistTurn(h, w, r)
	if !ok {
		return
	}
	runPersistAndRespond(h, w, r, av.Data.OwnerID, req)
}

func runPersistAndRespond(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	ownerID string, req *persistTurnRequest,
) {
	if perr := usecases.PersistVisitorTurn(r.Context(),
		&usecases.PersistTurnDeps{Conv: h.Visitor.Conv, SEO: h.SEO, Log: h.Log},
		&usecases.PersistVisitorTurnInput{
			OwnerID:          ownerID,
			ConversationID:   chi.URLParam(r, "id"),
			UserText:         req.UserText,
			AssistantText:    req.AssistantText,
			CitedWikiPaths:   req.CitedWikiPaths,
			CitedOutputPaths: req.CitedOutputPaths,
		},
	); perr != nil {
		h.Log.Error("persist turn", "err", perr)
		writeError(h.Log, w, persistTurnServerErr())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodePersistTurn(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (*persistTurnRequest, bool) {
	var req persistTurnRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return nil, false
	}
	if req.UserText == "" {
		writeError(h.Log, w, envBadReq("user_text is required"))
		return nil, false
	}
	return &req, true
}

func persistTurnServerErr() apierr.Envelope {
	return apierr.Envelope{
		Status:  http.StatusInternalServerError,
		Code:    "server_error",
		Message: "internal error",
	}
}
