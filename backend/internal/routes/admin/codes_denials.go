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

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
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

// denialFieldFor —— kind → add 请求 body 里的字段名。空 = 未知 kind。
// body 契约保持不变（capability_id / skill_id），前端只改 URL 不改 body。
func denialFieldFor(kind string) string {
	switch kind {
	case "capability":
		return "capability_id"
	case "skill":
		return "skill_id"
	default:
		return ""
	}
}

// addDenial —— POST /codes/{id}/denials/{kind}：kind ∈ {capability, skill}。
func (h *Handlers) addDenial() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := chi.URLParam(r, "kind")
		req, ok := h.scopedDenialReq(w, r, kind)
		if !ok {
			return
		}
		if err := h.addDenialByKind(r.Context(), kind, req.codeID, req.value); err != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusCreated)
	}
}

// scopedDenialReq —— 校验 kind 合法（capability/skill）+ code owner-scope + 解出 body
// 字段（capability_id / skill_id）。任一失败已写好响应，返 ok=false。
func (h *Handlers) scopedDenialReq(
	w http.ResponseWriter, r *http.Request, kind string,
) (denialReq, bool) {
	field := denialFieldFor(kind)
	if field == "" {
		writeError(h.Log, w, unknownDenialKind())
		return denialReq{}, false
	}
	return h.scopedFieldReq(w, r, field)
}

func (h *Handlers) addDenialByKind(ctx context.Context, kind, codeID, value string) error {
	if kind == "skill" {
		return h.CodesAdmin.Denials.AddSkill(ctx, codeID, value)
	}
	return h.CodesAdmin.Denials.AddCapability(ctx, codeID, value)
}

// deleteDenial —— DELETE /codes/{id}/denials/{kind}/{targetId}。
func (h *Handlers) deleteDenial() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := chi.URLParam(r, "kind")
		codeID, ok := h.scopedDenialCode(w, r, kind)
		if !ok {
			return
		}
		target := chi.URLParam(r, "targetId")
		if err := h.deleteDenialByKind(r.Context(), kind, codeID, target); err != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// scopedDenialCode —— 校验 kind 合法 + code owner-scope，返 codeID。失败已写好响应。
func (h *Handlers) scopedDenialCode(
	w http.ResponseWriter, r *http.Request, kind string,
) (string, bool) {
	if denialFieldFor(kind) == "" {
		writeError(h.Log, w, unknownDenialKind())
		return "", false
	}
	return h.scopedCodeID(w, r)
}

func (h *Handlers) deleteDenialByKind(ctx context.Context, kind, codeID, target string) error {
	if kind == "skill" {
		return h.CodesAdmin.Denials.DeleteSkill(ctx, codeID, target)
	}
	return h.CodesAdmin.Denials.DeleteCapability(ctx, codeID, target)
}

func unknownDenialKind() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusNotFound, Code: "unknown_denial_kind", Message: "unknown denial kind",
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
