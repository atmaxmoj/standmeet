// codes_ghost.go —— F-A-10 per-code 覆盖「内容型引导 ghost 需带语料证据」开关的 PATCH handler。
// 从 codes.go 拆出守 max-lines(350)。错误/成功回写复用 codes.go 的 handleUpdateQuotasErr /
// writeQuotaResp(与 quota PATCH 同形态:同样返回整行 code view)。

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// setGhostEvidenceRequest —— null = 继承 role,true/false = 显式覆盖。
type setGhostEvidenceRequest struct {
	RequireGhostEvidence *bool `json:"require_ghost_evidence"`
}

func (h *Handlers) setCodeGhostEvidence() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req setGhostEvidenceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		codeID := chi.URLParam(r, "id")
		updated, err := h.CodesAdmin.Codes.SetGhostEvidence(
			r.Context(), ownerID, codeID, req.RequireGhostEvidence,
		)
		if err != nil {
			handleUpdateQuotasErr(h.Log, w, err)
			return
		}
		writeQuotaResp(r, h, w, &updated)
	}
}
