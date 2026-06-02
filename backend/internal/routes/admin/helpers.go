// helpers.go —— admin handler 共享小工具：generic 500 envelope。
// 原住在 tokens.go (C-1 已删 api_tokens 整个文件)，搬出来独立。

package admin

import (
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/apierr"
)

func serverErr() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}
