package main

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// imTokensReader — the function /internal/im/config uses to read the sole owner's connected im
// suppliers: block id → bot token. Lives here (composition root), not in the route layer, so the
// route stays off the supplier implementation (go-arch-lint). Names no block: the im-bridge knows
// which block is which chat platform. Empty map when nothing is connected — the bridge polls.
func imTokensReader(d *deps.Runtime) func(context.Context) map[string]string {
	seo := owner.SEODeps{Owners: d.OwnerRepo}
	return func(ctx context.Context) map[string]string {
		soleOwner, ok := owner.FirstOwner(ctx, seo)
		if !ok {
			return map[string]string{}
		}
		conns, err := d.Credentials.ListBySeam(ctx, soleOwner.ID, "im")
		if err != nil {
			d.Log.Error("list im suppliers", "err", err)
			return map[string]string{}
		}
		return imTokens(d.Log, conns)
	}
}

// imTokens — block id → the token it stores, for every CONNECTED im supplier. A stored token whose
// connect was refused (the service did not accept it) is not handed over: on sijie the bridge ran
// a token Discord refused and crash-looped.
func imTokens(log *slog.Logger, conns []credentials.Connection) map[string]string {
	out := make(map[string]string, len(conns))
	for i := range conns {
		if !conns[i].Connected {
			continue
		}
		if token := connToken(log, &conns[i]); token != "" {
			out[conns[i].BlockID] = token
		}
	}
	return out
}

// connToken — the token a credential-only im supplier stores ("" when none or unreadable).
func connToken(log *slog.Logger, c *credentials.Connection) string {
	if len(c.Credentials) == 0 {
		return ""
	}
	var cred struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(c.Credentials, &cred); err != nil {
		log.Error("decode im credentials", "block", c.BlockID, "err", err)
		return ""
	}
	return cred.Token
}
