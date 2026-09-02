// errors.go —— shared envelope/writeError helpers. Split out of chat.go to stay under
// max-lines; used by persist_turn.go and later handlers too.

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

// envCodeLockedWait / envCodeLockedCaptcha —— #169 access-code redemption failing past
// threshold → 429 lockout (brute-force enumeration protection). **One lockout, two
// messages**, chosen by whether this instance can currently offer a way through:
//
//   - captcha off (the default deployment): no check to clear, only the window to wait
//     out → says "try again later".
//   - captcha on: the check is right there on the screen → says "clear it once and
//     you're through".
//
// Mixing them up is a lie either way: saying "try again later" makes someone stare at a
// way out that's right in front of them and wait fifteen minutes for nothing; saying
// "clear a human check" sends them looking for a control that isn't on the page, and
// when they can't find it they'll think they're locked out for good.
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

// nopResponseWriter —— the BYOAI envelope helper writes a 401 on missing headers, but
// llm_chat_stream takes control in the SSE phase and writes its own error response;
// feeding that helper a silent ResponseWriter lets it inspect headers without ever
// hitting the wire.
type nopResponseWriter struct{}

func (*nopResponseWriter) Header() http.Header         { return http.Header{} }
func (*nopResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (*nopResponseWriter) WriteHeader(_ int)           {}
