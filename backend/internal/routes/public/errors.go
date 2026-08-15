// errors.go —— 共享 envelope/writeError helper。chat.go 守 max-lines
// 拆出来；persist_turn.go + 后续 handler 都用。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

func envBadReq(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}

func serverErr() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error",
		Message: "server error",
	}
}

// envCodeLockedWait / envCodeLockedCaptcha —— #169 访问码兑换失败超阈值 → 429 锁定
// (暴力枚举防护)。**同一个锁，两句话**，按这台实例此刻给不给得出那条出路选：
//
//   - captcha 关着（默认部署）：没有校验可解，只能等窗口过去 → 说「稍后再试」。
//   - captcha 开着：屏幕上就摆着那道校验 → 说「过一次就放你过去」。
//
// 混用哪一句都是谎：说「稍后再试」会让人对着眼前的出路干等十五分钟；说「过一次人机校验」
// 会让人去找一个页面上根本不存在的控件，找不到就以为自己被永久挡住了。
func envCodeLockedWait() apierr.Envelope {
	return codeLocked("too many invalid codes from here — try again in a few minutes")
}

func envCodeLockedCaptcha() apierr.Envelope {
	return codeLocked("too many invalid codes from here — clear the human check and try again")
}

func codeLocked(msg string) apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusTooManyRequests, Code: "code_locked", Message: msg,
	}
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

// nopResponseWriter —— BYOAI envelope helper writes 401 on missing
// headers，但 llm_chat_stream 在 SSE 阶段 take control 自己写错误响应；
// 拿一个静默 ResponseWriter 喂给那个 helper 让它能 inspect headers
// 但不能 hit wire。
type nopResponseWriter struct{}

func (*nopResponseWriter) Header() http.Header         { return http.Header{} }
func (*nopResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (*nopResponseWriter) WriteHeader(_ int)           {}
