// helpers.go —— admin handler 共享小工具：generic 500 envelope + JSON 写出。
// 原住在 tokens.go / calendar_connector.go（已删），搬出来独立。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/apierr"
)

const logErrKey = "err"

func serverErr() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}

// writeJSON —— 200 + JSON body。
//
//nolint:forbidigo // json.Encoder.Encode 必须 interface{}; 集中此处放行
func writeJSON(log *slog.Logger, w http.ResponseWriter, v any) {
	writeJSONStatus(log, w, http.StatusOK, v)
}

// writeCreated —— 201 + JSON body（资源创建）。
//
//nolint:forbidigo // 透传给 writeJSONStatus（已放行）；签名需 any
func writeCreated(log *slog.Logger, w http.ResponseWriter, v any) {
	writeJSONStatus(log, w, http.StatusCreated, v)
}

//nolint:forbidigo // json.Encoder.Encode 必须 interface{}; 集中此处放行
func writeJSONStatus(log *slog.Logger, w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("encode json", logErrKey, err)
	}
}
