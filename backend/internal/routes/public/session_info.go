// session_info.go —— GET /api/v1/session —— F-L-11: a liveness probe for the stored visitor bearer.
//
// Visitor sessions live in Redis with a sliding TTL; the frontend keeps its `standmeet-session` in
// localStorage indefinitely. After the TTL lapses the Redis session is gone, but the reader still
// rendered full "unlocked" chrome from localStorage and fetched scoped data anonymously (→ empty
// body under a header boasting a corpus the viewer can't see). This endpoint lets the client ask
// the server whether the token is still live: `withVisitorSession` 401s a dead/expired token, and a
// live one gets 200 with mode + expiry so the reader can drop stale chrome or refresh from truth.

package public

import (
	"encoding/json"
	"net/http"
	"time"
)

type sessionInfoResp struct {
	Mode      string `json:"mode"`
	ExpiresAt string `json:"expires_at"`
}

func (h *Handlers) getSessionInfo() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		resp := sessionInfoResp{
			Mode:      av.Data.Mode,
			ExpiresAt: av.Data.ExpiresAt.Format(time.RFC3339),
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			h.Log.Error("encode session info", "err", err)
		}
	}
}
