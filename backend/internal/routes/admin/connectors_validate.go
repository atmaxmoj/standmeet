// connectors_validate.go —— #155 区 A：POST /connectors/validate-spec。admin UI 贴/URL 拉一份
// OpenAPI spec → 校验 → 回候选标题或人类可读拒绝理由（连接器装配前的摄入闸）。拆出 connectors.go
// 守 max-lines。

package admin

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/connectorsvc"
)

// maxSpecBodyBytes —— validate-spec 请求体上限（spec 文本 + JSON 信封余量；超大 spec 前端先拒）。
const maxSpecBodyBytes = 4 << 20 // 4 MiB

type validateSpecReq struct {
	Spec string `json:"spec"`
	URL  string `json:"url"`
}

type validateSpecResp struct {
	Title string                 `json:"title,omitempty"`
	Error string                 `json:"error,omitempty"`
	Auth  connectorsvc.AuthForms `json:"auth"`
	OK    bool                   `json:"ok"`
}

// validateSpec —— 校验摄入的 spec。坏 body → 400；校验失败 → 200 {ok:false,error}（人类可读，
// owner 直接看）；成功 → 200 {ok:true,title}。
func (h *Handlers) validateSpec() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body validateSpecReq
		dec := json.NewDecoder(io.LimitReader(r.Body, maxSpecBodyBytes))
		if derr := dec.Decode(&body); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		v := h.ConnectorsAdmin.Svc.ValidateSpec(r.Context(), []byte(body.Spec), body.URL)
		if !v.OK {
			writeJSON(h.Log, w, validateSpecResp{OK: false, Error: v.Reason})
			return
		}
		writeJSON(h.Log, w, validateSpecResp{OK: true, Title: v.Title, Auth: v.Auth})
	}
}
