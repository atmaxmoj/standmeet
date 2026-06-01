// errors.go —— 共享 envelope/writeError helper。chat.go 守 max-lines
// 拆出来；persist_turn.go + 后续 handler 都用。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/wangsijie/standmeet/internal/apierr"
)

func envBadReq(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}

func writeError(log *slog.Logger, w http.ResponseWriter, env apierr.Envelope) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(env.Status)
	payload := map[string]map[string]string{
		"error": {"code": env.Code, "message": env.Message},
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Error("encode error envelope", "err", err)
	}
}
