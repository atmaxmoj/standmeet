// im.go — GET /internal/im/config: hands the im-bridge service the owner's Telegram bot
// token so it can run the bot.
//
// **Why this exists**: im-bridge is a deployed Telegram bot that polls this endpoint for a
// token (im-bridge/src/config.ts), waiting until the owner has configured one. Before this,
// the endpoint didn't exist and there was no telegram connector, so the bridge waited
// forever and the owner had no way to see or set up their bot. Now the owner connects a
// "Telegram" connector under /admin/connectors (the token lands encrypted in
// owner_connectors), and this route reads it back for the bridge.
//
// No auth: it lives behind the trusted-internal boundary (Caddy blocks /internal from the
// public internet), the same lane as /internal/builds/*.
//
// The token is read through a **function** the composition root supplies, not by reaching
// into the connector package here — the route layer stays off the connector implementation
// (go-arch-lint: sysroutes may not depend on connector). cmd/server owns that read.

package sys

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// IMDeps — deps for /internal/im/config. Token resolves the sole owner's current Telegram
// bot token (empty when nothing is connected — normal; the bridge polls until one appears).
type IMDeps struct {
	Log   *slog.Logger
	Token func(ctx context.Context) string
}

// MountIM — mounts /im/config; the caller has already added the /internal prefix.
func MountIM(r chi.Router, deps IMDeps) {
	r.Get("/im/config", imConfig(deps))
}

// imConfig — responds {"telegram_token": "..."} — empty when nothing is connected, which
// is normal (the bridge polls every 15s until a token appears).
func imConfig(deps IMDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if deps.Token != nil {
			token = deps.Token(r.Context())
		}
		body := map[string]string{"telegram_token": token}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(body); err != nil {
			deps.Log.Error("encode im config", "err", err)
		}
	}
}
