// protocol_telegram.go — the protocol-kind Telegram supplier.
//
// Unlike smtp/caldav, this supplier has no seam contract and does nothing itself: the
// owner stores a bot token here, and the separate `im-bridge` service reads that token from
// `GET /internal/im/config` and runs the actual Telegram bot (ingest + visitor chat). So
// "connected" just means the owner saved a token — there is no Verify (this process never
// talks to Telegram; the bridge does). Credentials never leave the vault layer.

package adapters

import (
	"context"
	"fmt"
)

// TelegramVault — the connection source for a protocol(telegram) supplier: whether a bot
// token is stored (and the supplier marked connected) for this owner.
type TelegramVault interface {
	Connected(ctx context.Context, blockID, ownerID string) (bool, error)
}

// telegramSupplier — implements the Supplier base surface. No Verifier: a protocol
// supplier with no connect-time test is marked connected on connect (VerifySupplier
// returns nil for a non-Verifier), which is exactly right here — the owner pasting a token
// is the whole act.
type telegramSupplier struct {
	vault TelegramVault
	id    string
}

// NewTelegramSupplier — assemble a Telegram protocol supplier.
func NewTelegramSupplier(id string, vault TelegramVault) Supplier {
	return &telegramSupplier{vault: vault, id: id}
}

// Name — Supplier base surface.
func (c *telegramSupplier) Name() string { return c.id }

// Kind — a protocol supplier always reports kind=protocol.
func (*telegramSupplier) Kind() string { return "protocol" }

// Connected — whether the owner has stored a token and connected, delegates to the vault.
func (c *telegramSupplier) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("supplier %q connected: %w", c.id, err)
	}
	return ok, nil
}
