// access_requests.go —— admin /access-requests endpoint (list + status update).

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// AccessRequestsDeps —— admin access-requests handlers 依赖。
type AccessRequestsDeps struct {
	Reqs    usecases.AccessRequestsDeps
	Approve usecases.ApproveRequestDeps
}

type approveResponse struct {
	Code string `json:"code"`
	Link string `json:"link"`
}

type accessRequestView struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Org       string `json:"org"`
	Email     string `json:"email"`
	Message   string `json:"message"`
	Status    string `json:"status"`
}

type patchRequestBody struct {
	Status string `json:"status"`
}

// MountAccessRequests 挂 /access-requests 子路由。
func (h *Handlers) MountAccessRequests(r chi.Router) {
	r.Get("/access-requests", h.listAccessRequests())
	r.Patch("/access-requests/{id}", h.updateAccessRequest())
	r.Post("/access-requests/{id}/approve", h.approveAccessRequest())
}

// approveAccessRequest —— 批准:issue AccessCode + 邮件发 requester + 状态置 replied。
func (h *Handlers) approveAccessRequest() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		id := chi.URLParam(r, "id")
		out, err := usecases.ApproveAccessRequest(
			r.Context(), h.AccessRequests.Approve, ownerID, id)
		if err != nil {
			handleApproveErr(h.Log, w, err)
			return
		}
		writeJSON(h.Log, w, approveResponse{Code: out.Code, Link: out.Link})
	}
}

func (h *Handlers) listAccessRequests() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		status := r.URL.Query().Get("status")
		rows, err := usecases.ListForOwner(r.Context(), h.AccessRequests.Reqs, ownerID, status)
		if err != nil {
			handleAdminAccessRequestErr(h.Log, w, err)
			return
		}
		writeAccessRequestList(h.Log, w, rows)
	}
}

func (h *Handlers) updateAccessRequest() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		id := chi.URLParam(r, "id")
		var body patchRequestBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		out, err := usecases.UpdateAccessRequestStatus(
			r.Context(), h.AccessRequests.Reqs, ownerID, id, body.Status,
		)
		if err != nil {
			handleAdminAccessRequestErr(h.Log, w, err)
			return
		}
		writeAccessRequestSingle(h.Log, w, &out)
	}
}

func writeAccessRequestList(
	log *slog.Logger, w http.ResponseWriter, rows []access.AccessRequest,
) {
	items := make([]accessRequestView, 0, len(rows))
	for i := range rows {
		items = append(items, toAccessRequestView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode access requests", "err", err)
	}
}

func writeAccessRequestSingle(
	log *slog.Logger, w http.ResponseWriter, a *access.AccessRequest,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(toAccessRequestView(a)); err != nil {
		log.Error("encode access request", "err", err)
	}
}

func toAccessRequestView(a *access.AccessRequest) accessRequestView {
	return accessRequestView{
		ID:        a.ID,
		Name:      a.Name,
		Org:       a.Org,
		Email:     a.Email,
		Message:   a.Message,
		Status:    a.Status,
		CreatedAt: a.CreatedAt.Format(time.RFC3339),
	}
}

var adminAccessRequestErrCases = []apierr.Case{
	{Match: usecases.ErrEmptyField, Envelope: envBadReq("missing required field")},
	{
		Match:    access.ErrAccessRequestStatusInvalid,
		Envelope: envBadReq("invalid status value"),
	},
	{Match: access.ErrAccessRequestNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "request not found",
	}},
}

func handleAdminAccessRequestErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, adminAccessRequestErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("admin access requests", "err", err)
	}
	writeError(log, w, env)
}

var approveErrCases = []apierr.Case{
	{Match: consumer.ErrMailNotConfigured, Envelope: envBadReq(
		"configure and test your mail connector first")},
	{Match: access.ErrAccessRequestNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "request not found",
	}},
}

func handleApproveErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, approveErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("approve access request", "err", err)
	}
	writeError(log, w, env)
}
