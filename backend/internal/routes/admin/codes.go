// codes.go —— /api/admin/codes/*：owner 发出去的邀请码。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：
// 资源 id 走路径、其余进 body，denial 的 kind 和 target 也在路径上（历史形状，前端按它写的）。
//
// 出站载荷跟 MCP 面是同一份。迁移前差了三处：
//   - MCP 的 codes.list 少 require_ghost_evidence / prompt_id；
//   - corpus 拒绝（ACL 的第三类）只有 admin 有一条单独路由，MCP 的 list_denials 看不到；
//   - waypoints / corpus / ghost-evidence 三条路由在手写台账里一行都没有，棘轮看不见。

package admin

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// 路径参数名 —— 前端按这套 URL 形状写的,改名要连着前端一起改。
const (
	paramCodeID   = "code_id"
	paramKind     = "kind"
	paramTargetID = "target_id"
)

// CodesDeps —— admin codes handlers 的能力来源。
type CodesDeps struct {
	Face *dispatcher.Face
}

// MountCodes 挂 /codes 子路由（caller 已经在 /codes 前缀内）。
func (h *Handlers) MountCodes(r chi.Router) {
	face := h.CodesAdmin.Face
	r.Get("/", h.dispatchOp(face, "codes.list", emptyArgs, jsonOK))
	r.Post("/", h.dispatchOp(face, "codes.create", bodyArgs, jsonCreated))
	r.Post("/{code_id}/revoke",
		h.dispatchOp(face, "codes.revoke", urlParamArgs(paramCodeID), jsonOK))
	r.Patch("/{code_id}/quotas",
		h.dispatchOp(face, "codes.update_quotas", bodyWithURLParam(paramCodeID), jsonOK))
	r.Patch("/{code_id}/ghost-evidence",
		h.dispatchOp(face, "codes.set_ghost_evidence", bodyWithURLParam(paramCodeID), jsonOK))
	// 这张码开哪一页。空 slug = 解绑，退回默认的访客对话。
	r.Patch("/{code_id}/custom-page",
		h.dispatchOp(face, "codes.set_custom_page", bodyWithURLParam(paramCodeID), jsonOK))
	r.Get("/{code_id}/members",
		h.dispatchOp(face, "codes.list_members", urlParamArgs(paramCodeID), jsonOK))
	h.mountCodeACL(r, face)
}

// mountCodeACL —— 一张码的 ACL 面：三类拒绝 + 引导目的地。
//
// 三类拒绝以前分在两处：capability/skill 走 /denials/{kind}，corpus 走单独的 /corpus。
// 现在同一个 op，kind 是参数 —— 它们本来就是"在 role 给的范围上再收窄一层"的三个维度。
func (h *Handlers) mountCodeACL(r chi.Router, face *dispatcher.Face) {
	r.Get("/{code_id}/waypoints",
		h.dispatchOp(face, "codes.waypoints", urlParamArgs(paramCodeID), jsonOK))
	r.Put("/{code_id}/waypoints",
		h.dispatchOp(face, "codes.set_waypoints", bodyWithURLParam(paramCodeID), jsonOK))
	r.Get("/{code_id}/denials",
		h.dispatchOp(face, "codes.list_denials", urlParamArgs(paramCodeID), jsonOK))
	// 整份替换一类拒绝。今天只有 corpus 这类是"一张清单"（owner 在文本框里编辑），
	// 所以 kind 固定在路径上，形状留着给以后另外两类。
	r.Put("/{code_id}/denials/corpus",
		h.dispatchOp(face, "codes.set_corpus_denials", bodyWithURLParam(paramCodeID), jsonOK))
	r.Post("/{code_id}/denials/{kind}",
		h.dispatchOp(face, "codes.add_denial", addDenialArgs, jsonCreated))
	r.Delete("/{code_id}/denials/{kind}/{target_id}",
		h.dispatchOp(face, "codes.remove_denial", pathDenialArgs, jsonOK))
}

// denialTargetFields —— 各 kind 在 body 里用的字段名（历史形状：字段名跟着 kind 变）。
// 收口那边统一是 target_id，这里做映射 —— 这就是"REST 形状留在面上"的具体样子。
//
// kind 本身是这条路由自己的路径段，所以在这儿是字面量；能接受哪几个值由 op 的 schema 说，
// 面不复述那份判断（给错了域会回一句 bad input）。
var denialTargetFields = map[string]string{
	"capability": "capability_id",
	"skill":      "skill_id",
	"corpus":     "uri",
}

// addDenialArgs —— POST /codes/{id}/denials/{kind}：kind 在路径，target 在 body。
func addDenialArgs(r *http.Request) (json.RawMessage, error) {
	kind := chi.URLParam(r, paramKind)
	fields, err := decodeBodyFields(r)
	if err != nil {
		return nil, err
	}
	target, ok := fields[denialTargetFields[kind]]
	if !ok {
		return nil, dispatcher.BadInput(
			"body must carry " + denialTargetFields[kind] + " for kind " + kind)
	}
	return marshalDenial(chi.URLParam(r, paramCodeID), kind, target)
}

// pathDenialArgs —— DELETE /codes/{id}/denials/{kind}/{target_id}：三样都在路径上。
func pathDenialArgs(r *http.Request) (json.RawMessage, error) {
	target, merr := json.Marshal(chi.URLParam(r, paramTargetID))
	if merr != nil {
		return nil, dispatcher.BadInput("invalid path parameter")
	}
	return marshalDenial(chi.URLParam(r, paramCodeID), chi.URLParam(r, paramKind), target)
}

func marshalDenial(codeID, kind string, target json.RawMessage) (json.RawMessage, error) {
	out, err := json.Marshal(map[string]json.RawMessage{
		"code_id":   json.RawMessage(strconv.Quote(codeID)),
		"kind":      json.RawMessage(strconv.Quote(kind)),
		"target_id": target,
	})
	if err != nil {
		return nil, dispatcher.BadInput("invalid denial request")
	}
	return out, nil
}
