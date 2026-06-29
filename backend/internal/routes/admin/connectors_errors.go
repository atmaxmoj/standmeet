// connectors_errors.go —— connectorsvc sentinel → HTTP envelope 的集中映射。拆出来让 connectors.go
// 守 max-lines，也把「错误怎么对外」收在一处：加一种连接器错只动这里，handler 不必碰。

package admin

import (
	"errors"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/connectorsvc"
)

// connErrCases —— sentinel → envelope（table-driven，apierr.Classify 派发；无匹配 → 500）。
var connErrCases = []apierr.Case{
	{Match: connectorsvc.ErrNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "not found",
	}},
	{Match: connectorsvc.ErrNoOAuthClient, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "connector credentials not set",
	}},
	{Match: connectorsvc.ErrConnectionFailed, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "connection test failed — check host/port/credentials",
	}},
	{Match: connectorsvc.ErrBuiltinReadonly, Envelope: apierr.Envelope{
		Status:  http.StatusConflict,
		Code:    "builtin_readonly",
		Message: "this connector is built-in and cannot be edited or deleted",
	}},
	// ErrInvalidManifest 不在表里：writeConnErr 特判它，回 err.Error()（带装配失败的具体原因，
	// owner 才知道改哪），比表里的通用文案有用。
}

// writeConnErr —— 把 connectorsvc sentinel 翻成 HTTP envelope（dispatch 集中此处，handler 保 ≤3）。
// 装配失败带上底层原因（坏 JSONata / 未知 op / 未知品类 / 不完整），owner 才知道改哪。
func (h *Handlers) writeConnErr(w http.ResponseWriter, err error) {
	if errors.Is(err, connectorsvc.ErrInvalidManifest) {
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "invalid_manifest", Message: err.Error(),
		})
		return
	}
	env := apierr.Classify(err, connErrCases)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("connector admin", logErrKey, err)
	}
	writeError(h.Log, w, env)
}
