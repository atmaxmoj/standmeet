// credential_only.go — a credential-only supplier: the owner stores a credential (a bot token,
// a webhook secret) and the supplier does nothing itself. It has no seam contract and no
// connect-time test — "connected" just means the owner saved the credential. Some other service
// consumes it out of band (the Telegram `im` case: the separate `im-bridge` reads the token from
// `GET /internal/im/config` and runs the bot). The host names no specific protocol here: this is
// selected by the manifest declaring `kind: credential`, so a token-only block needs no host code.
//
// This generalizes what used to be a per-protocol `NewTelegramSupplier` reached by a
// `switch m.Protocol { case "telegram" }` — the host naming a block, which everything-is-a-block
// forbids (host stays blind to blocks; a built-in is just a plugin someone wrote early).

package adapters

import (
	"context"
	"fmt"
)

// ConnectionVault — the connection source for a credential-only supplier: whether a credential is
// stored (and the supplier marked connected) for this owner. The credentials repo satisfies it.
type ConnectionVault interface {
	Connected(ctx context.Context, blockID, ownerID string) (bool, error)
}

// credentialOnlySupplier — implements the Supplier base surface. No Verifier: a supplier with no
// connect-time test is marked connected on connect (VerifySupplier returns nil for a non-Verifier),
// which is exactly right here — the owner saving the credential is the whole act.
type credentialOnlySupplier struct {
	vault ConnectionVault
	id    string
}

// NewCredentialOnlySupplier — assemble a credential-only supplier (a token holder, no client code).
func NewCredentialOnlySupplier(id string, vault ConnectionVault) Supplier {
	return &credentialOnlySupplier{vault: vault, id: id}
}

// Name — Supplier base surface.
func (c *credentialOnlySupplier) Name() string { return c.id }

// Kind — a credential-only supplier reports kind=credential.
func (*credentialOnlySupplier) Kind() string { return "credential" }

// Connected — whether the owner has stored the credential and connected; delegates to the vault.
func (c *credentialOnlySupplier) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("supplier %q connected: %w", c.id, err)
	}
	return ok, nil
}
