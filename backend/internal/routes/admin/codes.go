// codes.go —— admin /codes endpoint (M6 minimal: POST 创建 + GET list).

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// CodesDeps —— admin codes handlers 依赖。
type CodesDeps struct {
	Codes *postgres.CodeRepo
}

type createCodeRequest struct {
	Code               string   `json:"code"`
	Label              string   `json:"label"`
	Purpose            string   `json:"purpose"`
	IncludedTags       []string `json:"included_tags"`
	ExcludedTags       []string `json:"excluded_tags"`
	SuggestedQuestions []string `json:"suggested_questions"`
}

type codeView struct {
	CreatedAt          string   `json:"created_at"`
	ID                 string   `json:"id"`
	Code               string   `json:"code"`
	Label              string   `json:"label"`
	Status             string   `json:"status"`
	IncludedTags       []string `json:"included_tags"`
	ExcludedTags       []string `json:"excluded_tags"`
	SuggestedQuestions []string `json:"suggested_questions"`
}

// MountCodes 挂 /codes 子路由。
func (h *Handlers) MountCodes(r chi.Router) {
	r.Get("/", h.listCodes())
	r.Post("/", h.createCode())
}

func (h *Handlers) listCodes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.CodesAdmin.Codes.ListByOwner(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("list codes", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeCodesList(h.Log, w, rows)
	}
}

func writeCodesList(log *slog.Logger, w http.ResponseWriter, rows []domain.AccessCode) {
	items := make([]codeView, 0, len(rows))
	for i := range rows {
		items = append(items, toCodeView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode codes", "err", err)
	}
}

func toCodeView(c *domain.AccessCode) codeView {
	return codeView{
		ID:                 c.ID,
		Code:               c.Code,
		Label:              c.Label,
		Status:             c.Status,
		IncludedTags:       c.IncludedTags,
		ExcludedTags:       c.ExcludedTags,
		SuggestedQuestions: c.SuggestedQuestions,
		CreatedAt:          c.CreatedAt.Format(time.RFC3339),
	}
}

func (h *Handlers) createCode() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createCodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		code, err := h.CodesAdmin.Codes.Create(r.Context(), &postgres.CreateCodeInput{
			OwnerID:            ownerID,
			Code:               req.Code,
			Label:              req.Label,
			Purpose:            req.Purpose,
			IncludedTags:       req.IncludedTags,
			ExcludedTags:       req.ExcludedTags,
			SuggestedQuestions: req.SuggestedQuestions,
		})
		if err != nil {
			h.Log.Error("create code", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeCreatedCode(h.Log, w, &code)
	}
}

func writeCreatedCode(log *slog.Logger, w http.ResponseWriter, c *domain.AccessCode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(toCodeView(c)); err != nil {
		log.Error("encode code", "err", err)
	}
}

// 为防 apierr unused import in pkg：reference it.
var _ = apierr.Envelope{}
