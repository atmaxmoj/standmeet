// appearance.go —— admin /appearance/css:owner 自定义 CSS 的读/写。写时经 owner.SetOwnerCSS
// sanitize+scope 后落库;读回的是那个安全版本。owner CSS 三面(UI/MCP/sync)写同一处(owners.custom_css)。

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// MountAppearance —— /appearance 子路由。
func (h *Handlers) MountAppearance(r chi.Router) {
	r.Route("/appearance", func(r chi.Router) {
		r.Get("/css", h.getOwnerCSS())
		r.Put("/css", h.setOwnerCSS())
	})
}

func (h *Handlers) getOwnerCSS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		css, err := h.AccountAdmin.Account.Owners.GetCSS(r.Context(), ownerID)
		if err != nil {
			writeError(h.Log, w, envBadReq("read css"))
			return
		}
		writeJSON(h.Log, w, map[string]string{"css": css})
	}
}

func (h *Handlers) setOwnerCSS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var body struct {
			CSS string `json:"css"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid body"))
			return
		}
		if err := owner.SetOwnerCSS(
			r.Context(), h.AccountAdmin.Account.Owners, ownerID, body.CSS,
		); err != nil {
			writeError(h.Log, w, envBadReq("save css"))
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}
