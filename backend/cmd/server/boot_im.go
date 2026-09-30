package main

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
)

// discordBlockID —— the discord block (backend/blocks/discord). Every other im supplier is a
// Telegram bot: the telegram block, and the credential suppliers created before discord existed.
const discordBlockID = "discord"

// imTokensReader — the function /internal/im/config uses to read the sole owner's current bot
// token per platform. Lives here (composition root), not in the route layer, so the route stays
// off the supplier implementation (go-arch-lint). An empty token means the owner has not
// connected that platform — the im-bridge treats that as "not yet", polling.
func imTokensReader(d *deps.Runtime) func(context.Context) sysroutes.IMTokens {
	seo := owner.SEODeps{Owners: d.OwnerRepo}
	return func(ctx context.Context) sysroutes.IMTokens {
		soleOwner, ok := owner.FirstOwner(ctx, seo)
		if !ok {
			return sysroutes.IMTokens{}
		}
		conns, err := d.Credentials.ListBySeam(ctx, soleOwner.ID, "im")
		if err != nil {
			d.Log.Error("list im suppliers", "err", err)
			return sysroutes.IMTokens{}
		}
		return imTokens(d.Log, conns)
	}
}

// imTokens — the first usable token per platform. Disconnecting a supplier clears its
// credentials (ClearTokens), so an empty credential already means "not usable".
func imTokens(log *slog.Logger, conns []credentials.Connection) sysroutes.IMTokens {
	var t sysroutes.IMTokens
	for i := range conns {
		token := connToken(log, &conns[i])
		switch {
		case token == "":
		case conns[i].BlockID == discordBlockID:
			t.Discord = firstNonEmpty(t.Discord, token)
		default:
			t.Telegram = firstNonEmpty(t.Telegram, token)
		}
	}
	return t
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

func firstNonEmpty(have, next string) string {
	if have != "" {
		return have
	}
	return next
}
