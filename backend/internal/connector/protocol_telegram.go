// protocol_telegram.go — the protocol-kind Telegram connector.
//
// Unlike smtp/caldav, this connector has no category contract and does nothing itself: the
// owner stores a bot token here, and the separate `im-bridge` service reads that token from
// `GET /internal/im/config` and runs the actual Telegram bot (ingest + visitor chat). So
// "connected" just means the owner saved a token — there is no Verify (this process never
// talks to Telegram; the bridge does). Credentials never leave the vault layer.

package connector

import (
	"context"
	"fmt"
)

// TelegramVault — the connection source for a protocol(telegram) connector: whether a bot
// token is stored (and the connector marked connected) for this owner.
type TelegramVault interface {
	Connected(ctx context.Context, connectorID, ownerID string) (bool, error)
}

// telegramConnector — implements the Connector base surface. No Verifier: a protocol
// connector with no connect-time test is marked connected on connect (VerifyConnector
// returns nil for a non-Verifier), which is exactly right here — the owner pasting a token
// is the whole act.
type telegramConnector struct {
	vault TelegramVault
	id    string
}

// NewTelegramConnector — assemble a Telegram protocol connector.
func NewTelegramConnector(id string, vault TelegramVault) Connector {
	return &telegramConnector{vault: vault, id: id}
}

// Name — Connector base surface.
func (c *telegramConnector) Name() string { return c.id }

// Kind — a protocol connector always reports kind=protocol.
func (*telegramConnector) Kind() string { return "protocol" }

// Connected — whether the owner has stored a token and connected, delegates to the vault.
func (c *telegramConnector) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q connected: %w", c.id, err)
	}
	return ok, nil
}
