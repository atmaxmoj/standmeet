package main

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/connector"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// telegramTokenReader — the function /internal/im/config uses to read the sole owner's
// current Telegram bot token. Lives here (composition root), not in the route layer, so
// the route stays off the connector implementation (go-arch-lint). Empty string when the
// owner has not connected a Telegram bot — the im-bridge treats that as "not yet", polling.
func telegramTokenReader(d *deps.Runtime) func(context.Context) string {
	seo := owner.SEODeps{Owners: d.OwnerRepo}
	return func(ctx context.Context) string {
		soleOwner, ok := owner.FirstOwner(ctx, seo)
		if !ok {
			return ""
		}
		conns, err := d.ConnectorRepo.ListByCategory(ctx, soleOwner.ID, "im")
		if err != nil {
			d.Log.Error("list im connectors", "err", err)
			return ""
		}
		return firstTelegramToken(d.Log, conns)
	}
}

// firstTelegramToken — the token off the first im connector that actually carries one.
// Disconnecting a connector clears its credentials (ClearTokens), so an empty credential
// already means "not usable" — no need to also gate on Connected/Active.
func firstTelegramToken(log *slog.Logger, conns []connector.Connection) string {
	for i := range conns {
		if len(conns[i].Credentials) == 0 {
			continue
		}
		var c struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(conns[i].Credentials, &c); err != nil {
			log.Error("decode telegram credentials", "err", err)
			continue
		}
		if c.Token != "" {
			return c.Token
		}
	}
	return ""
}
