// calendar_connector.go —— /api/admin/connectors/google-calendar/*
// Owner pastes their own Google OAuth client_id + client_secret in admin
// UI (self-hosted product — no global OAuth client). credentials get
// encrypted-at-rest by postgres.CalendarRepo. init/callback drive the
// OAuth dance; disconnect deletes the row.
//
// OAuth state lives in Redis (short TTL) so we can validate the callback's
// state param without a cookie + survive multi-tab admin scenarios.

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gcal"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const (
	gcalStateBytes  = 16
	gcalStateTTL    = 10 * time.Minute
	gcalStatePrefix = "gcal:oauth:state:"
	gcalScope       = "https://www.googleapis.com/auth/calendar"
)

// CalendarAdminDeps —— admin connectors/google-calendar handler 依赖。
type CalendarAdminDeps struct {
	Repo   *postgres.CalendarRepo
	GCal   *gcal.Client
	Redis  *redis.Client
	Random func(n int) (string, error) // 让测试注入；nil 走默认 crypto rand
}

// MountCalendarConnector 挂 /connectors/google-calendar/* 子路由。
func (h *Handlers) MountCalendarConnector(r chi.Router) {
	r.Route("/connectors/google-calendar", func(r chi.Router) {
		r.Post("/credentials", h.saveGCalCredentials())
		r.Get("/status", h.getGCalStatus())
		r.Post("/init", h.initGCalOAuth())
		r.Get("/callback", h.gcalOAuthCallback())
		r.Post("/disconnect", h.disconnectGCal())
	})
}

// ───── credentials ────────────────────────────────────────────

type gcalCredsRequest struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

func (h *Handlers) saveGCalCredentials() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runSaveGCalCredentials(r, h, w)
	}
}

func runSaveGCalCredentials(r *http.Request, h *Handlers, w http.ResponseWriter) {
	req, ok := decodeGCalCredsRequest(r, h, w)
	if !ok {
		return
	}
	ownerID := middleware.OwnerIDFrom(r.Context())
	if err := h.CalendarAdmin.Repo.SaveCredentials(r.Context(), &postgres.SaveCredentialsInput{
		OwnerID:      ownerID,
		Provider:     domain.CalendarProvider,
		ClientID:     req.ClientID,
		ClientSecret: req.ClientSecret,
	}); err != nil {
		h.Log.Error("save gcal credentials", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	writeJSON(h.Log, w, map[string]bool{"ok": true})
}

func decodeGCalCredsRequest(
	r *http.Request, h *Handlers, w http.ResponseWriter,
) (*gcalCredsRequest, bool) {
	var req gcalCredsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return nil, false
	}
	if credsMissing(&req) {
		writeError(h.Log, w, envBadReq("client_id + client_secret required"))
		return nil, false
	}
	return &req, true
}

func credsMissing(req *gcalCredsRequest) bool {
	return req.ClientID == "" || req.ClientSecret == ""
}

// ───── status ────────────────────────────────────────────────

type gcalStatusResponse struct {
	CalendarID     string   `json:"calendar_id,omitempty"`
	Scopes         []string `json:"scopes,omitempty"`
	HasCredentials bool     `json:"has_credentials"`
	Connected      bool     `json:"connected"`
}

func (h *Handlers) getGCalStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		conn, err := h.CalendarAdmin.Repo.GetConnector(r.Context(),
			ownerID, domain.CalendarProvider)
		if err != nil {
			h.Log.Error("get gcal connector", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, gcalStatusResponse{
			HasCredentials: conn.HasCredentials(),
			Connected:      conn.Connected(),
			CalendarID:     "primary",
			Scopes:         conn.Scopes,
		})
	}
}

// OAuth init/callback/disconnect 拆到 calendar_oauth.go 守 350-line cap。
// writeJSON helper 也搬过去同文件，保持本文件只含 credentials + status。

// writeJSON —— admin handler 通用 200 + JSON encoder。json.Encoder.Encode
// 签名本身就是 interface{}，业务层无法用 typed wrapper 避开；这是唯一
// 处用 any，集中纳入 nolint 范围。
//
//nolint:forbidigo // json.Encoder.Encode 必须 interface{}; 集中此处放行
func writeJSON(log *slog.Logger, w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("encode json", logErrKey, err)
	}
}

const logErrKey = "err"
