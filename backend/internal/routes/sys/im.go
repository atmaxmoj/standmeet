// im.go — GET /internal/im/config: hands the im-bridge service the owner's Telegram bot
// token so it can run the bot.
//
// **Why this exists**: im-bridge is a deployed Telegram bot that polls this endpoint for a
// token (im-bridge/src/config.ts), waiting until the owner has configured one. Before this,
// the endpoint didn't exist and there was no telegram supplier, so the bridge waited
// forever and the owner had no way to see or set up their bot. Now the owner connects a
// "Telegram" supplier under /admin/suppliers (the token lands encrypted in
// block_connections), and this route reads it back for the bridge.
//
// No auth: it lives behind the trusted-internal boundary (Caddy blocks /internal from the
// public internet), the same lane as /internal/builds/*.
//
// The token is read through a **function** the composition root supplies, not by reaching
// into the supplier package here — the route layer stays off the supplier implementation
// (go-arch-lint: sysroutes may not depend on it). cmd/server owns that read.

package sys

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// IMDeps — deps for /internal/im/config. Tokens resolves the sole owner's connected im suppliers:
// block id → bot token (empty map when nothing is connected — normal; the bridge polls until one
// appears). The host names no platform: which block is which chat platform is the bridge's
// knowledge, not the kernel's (check-host-blind-to-blocks).
//
// Pair —— the owner sent the bot a pairing code from a chat (notify-rules-and-live-transcript.md,
// *IM as a channel*): link that chat; false when the code is unknown, used or stale.
type IMDeps struct {
	Log    *slog.Logger
	Tokens func(ctx context.Context) map[string]string
	Pair   func(ctx context.Context, in PairRequest) bool
}

// PairRequest —— what the bridge saw: the code, and the chat it came from.
type PairRequest struct {
	Code     string `json:"code"`
	Platform string `json:"platform"`
	ChatID   string `json:"chat_id"`
}

// MountIM — mounts /im/config and /im/pair; the caller has already added the /internal prefix.
func MountIM(r chi.Router, deps IMDeps) {
	r.Get("/im/config", imConfig(deps))
	r.Post("/im/pair", imPair(deps))
}

// imPair —— {code, platform, chat_id} → {"linked": true|false}. "Not linked" is an answer the
// bridge relays to the person, not a fault; an unreadable body reads as not linked.
func imPair(deps IMDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in PairRequest
		linked := json.NewDecoder(r.Body).Decode(&in) == nil && deps.Pair(r.Context(), in)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]bool{"linked": linked}); err != nil {
			deps.Log.Error("encode im pair", "err", err)
		}
	}
}

// imConfig — responds {"tokens": {"<block id>": "<bot token>", …}} — empty when nothing is
// connected, which is normal (the bridge polls every 15s until one appears).
func imConfig(deps IMDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tokens := map[string]string{}
		if deps.Tokens != nil {
			tokens = deps.Tokens(r.Context())
		}
		body := map[string]map[string]string{"tokens": tokens}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(body); err != nil {
			deps.Log.Error("encode im config", "err", err)
		}
	}
}
