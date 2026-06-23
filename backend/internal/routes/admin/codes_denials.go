// codes_denials.go —— ACL hierarchy 的 code 层 admin 子路由
// (docs/design/capability-acl-hierarchy.md)。纯 deny：code 从所选 role 授的里再砍。
// 挂在 /codes 下（见 MountCodes）。owner-scope：每个 handler 先校验 code 属本 owner
// (否则 404)。CSRF 由 admin router 中间件统一挡（缺头 → 403），这里不另写。
// handler 守 routes-cyclo ≤3：owner-scope + body 解析抽成小 helper。

package admin

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

// codeDenialsResp —— GET /codes/{id}/denials 的读回形态（admin UI 用）。
type codeDenialsResp struct {
	CapabilityIDs []string `json:"capability_ids"`
	SkillIDs      []string `json:"skill_ids"`
}

func (h *Handlers) listCodeDenials() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID, ok := h.scopedCodeID(w, r)
		if !ok {
			return
		}
		resp, err := h.loadDenials(r.Context(), codeID)
		if err != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		writeDenialsJSON(h.Log, w, resp)
	}
}

func (h *Handlers) addCapabilityDenial() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := h.scopedFieldReq(w, r, "capability_id")
		if !ok {
			return
		}
		err := h.CodesAdmin.Denials.AddCapability(r.Context(), req.codeID, req.value)
		if err != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusCreated)
	}
}

func (h *Handlers) deleteCapabilityDenial() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID, ok := h.scopedCodeID(w, r)
		if !ok {
			return
		}
		capID := chi.URLParam(r, "capId")
		if err := h.CodesAdmin.Denials.DeleteCapability(r.Context(), codeID, capID); err != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *Handlers) addSkillDenial() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := h.scopedFieldReq(w, r, "skill_id")
		if !ok {
			return
		}
		if err := h.CodesAdmin.Denials.AddSkill(r.Context(), req.codeID, req.value); err != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusCreated)
	}
}

func (h *Handlers) deleteSkillDenial() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID, ok := h.scopedCodeID(w, r)
		if !ok {
			return
		}
		skillID := chi.URLParam(r, "skillId")
		if err := h.CodesAdmin.Denials.DeleteSkill(r.Context(), codeID, skillID); err != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// scopedCodeID —— owner-scope：URL 的 code 必须属本 owner，否则写 404 + 返 ok=false。
func (h *Handlers) scopedCodeID(w http.ResponseWriter, r *http.Request) (string, bool) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	codeID := chi.URLParam(r, "id")
	code, err := h.CodesAdmin.Codes.GetByID(r.Context(), codeID)
	if err != nil || code.OwnerID != ownerID {
		writeError(h.Log, w, codeNotFound())
		return "", false
	}
	return codeID, true
}

// denialReq —— owner-scope 通过的 code + body 里的目标 id（capability / skill）。
type denialReq struct {
	codeID string
	value  string
}

// scopedFieldReq —— owner-scope + 解出 body 里的单字段（capability_id / skill_id）。
// 缺字段/坏 body → 400。返回 (req, ok)。
func (h *Handlers) scopedFieldReq(
	w http.ResponseWriter, r *http.Request, field string,
) (denialReq, bool) {
	codeID, ok := h.scopedCodeID(w, r)
	if !ok {
		return denialReq{}, false
	}
	value, ok := decodeRequiredField(w, r, h.Log, field)
	if !ok {
		return denialReq{}, false
	}
	return denialReq{codeID: codeID, value: value}, true
}

// loadDenials —— 读这张 code 的两类 deny 集（admin UI 读路径）。
func (h *Handlers) loadDenials(ctx context.Context, codeID string) (codeDenialsResp, error) {
	caps, err := h.CodesAdmin.Denials.ListCapabilities(ctx, codeID)
	if err != nil {
		return codeDenialsResp{}, err
	}
	skills, err := h.CodesAdmin.Denials.ListSkills(ctx, codeID)
	if err != nil {
		return codeDenialsResp{}, err
	}
	return codeDenialsResp{CapabilityIDs: caps, SkillIDs: skills}, nil
}

// decodeRequiredField —— 解 body 里的一个必填字符串字段；缺/坏 → 400 + ok=false。
func decodeRequiredField(
	w http.ResponseWriter, r *http.Request, log *slog.Logger, field string,
) (string, bool) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body[field] == "" {
		writeError(log, w, envBadReq(field+" required"))
		return "", false
	}
	return body[field], true
}

func writeDenialsJSON(log *slog.Logger, w http.ResponseWriter, resp codeDenialsResp) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode code denials", "err", err)
	}
}

func codeNotFound() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "code not found",
	}
}
