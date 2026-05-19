// domains.go —— /api/admin/allowed-domains CRUD（list + add + remove）。
// 真正的 DNS / TLS 验证走 /internal/tls-ask（Caddy on-demand TLS path）。
// 这里只维护 instance_settings.allowed_domains 这个 jsonb 数组。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/usecases"
)

// DomainsDeps —— admin domains handlers 依赖。
type DomainsDeps struct {
	Domains usecases.AllowedDomainsDeps
}

type addDomainRequest struct {
	Domain string `json:"domain"`
}

type domainsListResp struct {
	Domains []string `json:"domains"`
}

// MountDomains 挂 /allowed-domains 子路由。
func (h *Handlers) MountDomains(r chi.Router) {
	r.Get("/allowed-domains", h.listDomains())
	r.Post("/allowed-domains", h.addDomain())
	r.Delete("/allowed-domains/{domain}", h.removeDomain())
}

func (h *Handlers) listDomains() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := usecases.ListAllowedDomains(r.Context(), h.Domains.Domains)
		if err != nil {
			h.Log.Error("list domains", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeDomainsList(h.Log, w, list)
	}
}

func (h *Handlers) addDomain() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req addDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		err := usecases.AddAllowedDomain(r.Context(), h.Domains.Domains, req.Domain)
		if err != nil {
			handleDomainsErr(h.Log, w, err, "add")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *Handlers) removeDomain() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dom := chi.URLParam(r, "domain")
		if err := usecases.RemoveAllowedDomain(r.Context(), h.Domains.Domains, dom); err != nil {
			handleDomainsErr(h.Log, w, err, "remove")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDomainsErr(log *slog.Logger, w http.ResponseWriter, err error, op string) {
	if errors.Is(err, usecases.ErrEmptyField) {
		writeError(log, w, envBadReq("domain is required"))
		return
	}
	log.Error(op+" allowed domain", "err", err)
	writeError(log, w, serverErr())
}

func writeDomainsList(log *slog.Logger, w http.ResponseWriter, list []string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(domainsListResp{Domains: list}); err != nil {
		log.Error("encode domains list", "err", err)
	}
}
