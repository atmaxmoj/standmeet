// mail_connector.go —— /api/admin/connectors/mail/*
// Owner pastes their own SMTP server (host/port/user/pass/from) in admin UI —
// self-hosted, no global mail service. credentials get encrypted-at-rest by
// postgres.MailRepo. /test sends a probe to the owner's own email and, on
// success, marks the connector connected; /disconnect deletes the row.

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// MailAdminDeps —— admin connectors/mail handler 依赖。
type MailAdminDeps struct {
	Repo   *postgres.MailRepo
	Owners *postgres.OwnerRepo
}

// MountMailConnector 挂 /connectors/mail/* 子路由。
func (h *Handlers) MountMailConnector(r chi.Router) {
	r.Route("/connectors/mail", func(r chi.Router) {
		r.Post("/credentials", h.saveMailCredentials())
		r.Get("/status", h.getMailStatus())
		r.Post("/test", h.testMailConnector())
		r.Post("/disconnect", h.disconnectMail())
	})
}

// ───── credentials ────────────────────────────────────────────

type mailCredsRequest struct {
	Host        string `json:"host"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	FromAddress string `json:"from_address"`
	FromName    string `json:"from_name"`
	Port        int    `json:"port"`
}

func (h *Handlers) saveMailCredentials() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runSaveMailCredentials(r, h, w)
	}
}

func runSaveMailCredentials(r *http.Request, h *Handlers, w http.ResponseWriter) {
	req, ok := decodeMailCredsRequest(r, h, w)
	if !ok {
		return
	}
	ownerID := middleware.OwnerIDFrom(r.Context())
	if err := h.MailAdmin.Repo.SaveConnector(r.Context(), &postgres.SaveMailConnectorInput{
		OwnerID:     ownerID,
		Provider:    domain.MailProvider,
		Host:        req.Host,
		Port:        req.Port,
		Username:    req.Username,
		Password:    req.Password,
		FromAddress: req.FromAddress,
		FromName:    req.FromName,
	}); err != nil {
		h.Log.Error("save mail credentials", logErrKey, err)
		writeError(h.Log, w, serverErr())
		return
	}
	writeJSON(h.Log, w, map[string]bool{"ok": true})
}

func decodeMailCredsRequest(
	r *http.Request, h *Handlers, w http.ResponseWriter,
) (*mailCredsRequest, bool) {
	var req mailCredsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return nil, false
	}
	if mailCredsMissing(&req) {
		writeError(h.Log, w, envBadReq("host, port and from_address are required"))
		return nil, false
	}
	return &req, true
}

func mailCredsMissing(req *mailCredsRequest) bool {
	return req.Host == "" || req.Port <= 0 || req.FromAddress == ""
}

// ───── status ────────────────────────────────────────────────

type mailStatusResponse struct {
	Host           string `json:"host,omitempty"`
	FromAddress    string `json:"from_address,omitempty"`
	FromName       string `json:"from_name,omitempty"`
	Port           int    `json:"port,omitempty"`
	HasCredentials bool   `json:"has_credentials"`
	Connected      bool   `json:"connected"`
}

func (h *Handlers) getMailStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		conn, err := h.MailAdmin.Repo.GetConnector(r.Context(), ownerID, domain.MailProvider)
		if err != nil {
			h.Log.Error("get mail connector", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, mailStatusResponse{
			Host:           conn.Host,
			Port:           conn.Port,
			FromAddress:    conn.FromAddress,
			FromName:       conn.FromName,
			HasCredentials: conn.HasCredentials(),
			Connected:      conn.Connected(),
		})
	}
}

// ───── test ───────────────────────────────────────────────────

func (h *Handlers) testMailConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		err := usecases.TestMailConnector(r.Context(), usecases.MailDeps{
			Mail: h.MailAdmin.Repo, Owners: h.MailAdmin.Owners,
		}, ownerID)
		if err != nil {
			handleMailTestErr(h.Log, w, err)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

// handleMailTestErr —— not-configured 是 400;发信失败给 user-friendly 502
// (不漏 SMTP 原始报错到 UI,只记日志)。
func handleMailTestErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, usecases.ErrMailNotConfigured) {
		writeError(log, w, envBadReq("configure your SMTP host and from address first"))
		return
	}
	log.Error("mail connector test", logErrKey, err)
	writeError(log, w, apierr.Envelope{
		Status:  http.StatusBadGateway,
		Code:    "mail_test_failed",
		Message: "Test email failed — check your SMTP host, port, and credentials.",
	})
}

// ───── disconnect ─────────────────────────────────────────────

func (h *Handlers) disconnectMail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		if err := h.MailAdmin.Repo.DeleteConnector(r.Context(),
			ownerID, domain.MailProvider); err != nil {
			h.Log.Error("disconnect mail", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}
