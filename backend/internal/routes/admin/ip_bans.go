// ip_bans.go —— /api/admin/ip-bans/* —— owner 看 / 加 / 删封禁 IP（#58-4）。
// 公开面 enforcement 走 middleware.BanGuard（另一处）；这里只是 owner 的 CRUD。
// 配合 conversations.client_ip 的「IP 感知」：owner 在对话里看到来源 IP →
// 来这儿封掉。

package admin

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// IPBansAdminDeps —— admin ip-bans handler 依赖。
type IPBansAdminDeps struct {
	Repo *postgres.BannedIPRepo
}

// MountIPBans 挂 /ip-bans/* 子路由。
func (h *Handlers) MountIPBans(r chi.Router) {
	r.Route("/ip-bans", func(r chi.Router) {
		r.Get("/", h.listIPBans())
		r.Post("/", h.createIPBan())
		r.Delete("/{id}", h.deleteIPBan())
	})
}

type banView struct {
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
	ID        string     `json:"id"`
	IP        string     `json:"ip"`
	Reason    string     `json:"reason"`
}

type createBanRequest struct {
	IP        string `json:"ip"`
	Reason    string `json:"reason"`
	ExpiresAt string `json:"expires_at"` // RFC3339；空 = 永久
}

func (h *Handlers) listIPBans() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		bans, err := h.IPBansAdmin.Repo.List(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("list ip bans", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, toBanViews(bans))
	}
}

func (h *Handlers) createIPBan() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeCreateBan(r, h, w)
		if !ok {
			return
		}
		ban, err := h.IPBansAdmin.Repo.Ban(r.Context(), &postgres.BanIPInput{
			OwnerID:   middleware.OwnerIDFrom(r.Context()),
			IP:        req.ip,
			Reason:    req.reason,
			ExpiresAt: req.expires,
		})
		if err != nil {
			h.Log.Error("ban ip", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, toBanView(&ban))
	}
}

func (h *Handlers) deleteIPBan() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		id := chi.URLParam(r, "id")
		if err := h.IPBansAdmin.Repo.Unban(r.Context(), ownerID, id); err != nil {
			h.Log.Error("unban ip", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

// parsedCreateBan —— decode + 校验后的 ban 入参（expires_at 已解析成指针）。
type parsedCreateBan struct {
	expires *time.Time
	ip      string
	reason  string
}

func decodeCreateBan(
	r *http.Request, h *Handlers, w http.ResponseWriter,
) (*parsedCreateBan, bool) {
	var req createBanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return nil, false
	}
	return validateCreateBan(&req, h, w)
}

func validateCreateBan(
	req *createBanRequest, h *Handlers, w http.ResponseWriter,
) (*parsedCreateBan, bool) {
	if req.IP == "" {
		writeError(h.Log, w, envBadReq("ip is required"))
		return nil, false
	}
	expires, perr := parseOptionalRFC3339(req.ExpiresAt)
	if perr != nil {
		writeError(h.Log, w, envBadReq("expires_at must be RFC3339 or empty"))
		return nil, false
	}
	return &parsedCreateBan{ip: req.IP, reason: req.Reason, expires: expires}, true
}

func parseOptionalRFC3339(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty = no expiry, not an error
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func toBanViews(bans []domain.BannedIP) []banView {
	out := make([]banView, 0, len(bans))
	for i := range bans {
		out = append(out, toBanView(&bans[i]))
	}
	return out
}

func toBanView(b *domain.BannedIP) banView {
	return banView{
		ID:        b.ID,
		IP:        b.IP,
		Reason:    b.Reason,
		ExpiresAt: b.ExpiresAt,
		CreatedAt: b.CreatedAt,
	}
}
