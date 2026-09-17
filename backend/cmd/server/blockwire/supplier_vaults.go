// supplier_vaults.go —— the credentials repo, seen through each port a supplier declares.
//
// Split out of supplier_register.go, which had grown past the max-lines ceiling, and along a
// real seam rather than wherever the lines ran out: everything here is **one adapter per
// narrow port** (connection state, the opaque block cred blob, which supplier is active for a
// seam), while the file it came from answers a different question — how a manifest becomes a
// live supplier and which seams get declared.
//
// Every adapter here swaps the argument order and hands back what its port asks for. Decryption
// already happened inside the repo; nothing on this side ever sees ciphertext or holds a key. A
// block supplier's credentials stay an OPAQUE blob here — the block declares and consumes the
// fields, so the host names none (no SMTP/CalDAV config struct on this side).

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// connectionStoreAdapter —— credentials.Repo → adapters.ConnectionStore (swaps arg order).
type connectionStoreAdapter struct{ repo *credentials.Repo }

func (a connectionStoreAdapter) Get(
	ctx context.Context, blockID, ownerID string,
) (credentials.Connection, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return conn, fmt.Errorf("connection store get: %w", err)
	}
	return conn, nil
}

// SaveTokens —— writes back a silent oauth2 refresh (adapters.TokenRefresh → storage).
func (a connectionStoreAdapter) SaveTokens(
	ctx context.Context, blockID, ownerID string, tok *adapters.TokenRefresh,
) error {
	if err := a.repo.SaveTokens(ctx, &credentials.SaveTokensInput{
		OwnerID: ownerID, BlockID: blockID,
		AccessToken: tok.AccessToken, RefreshToken: tok.RefreshToken,
		ExpiresAt: tok.ExpiresAt, Scopes: tok.Scopes,
	}); err != nil {
		return fmt.Errorf("connection store save tokens: %w", err)
	}
	return nil
}

// MarkDisconnected —— on revocation, clears token/connected/active; owner must reconnect.
func (a connectionStoreAdapter) MarkDisconnected(
	ctx context.Context, blockID, ownerID string,
) error {
	if err := a.repo.ClearTokens(ctx, ownerID, blockID); err != nil {
		return fmt.Errorf("connection store mark disconnected: %w", err)
	}
	return nil
}

// credVaultAdapter —— credentials.Repo → the opaque-credential port a block-backed supplier reads
// (blockCredVault): connection state + the owner's stored connect-form values as an OPAQUE JSON
// blob. The host does NOT decode the fields — the block declares them in its manifest `config` and
// consumes them. This is what keeps a block-backed seam (e.g. CalDAV) from needing any
// provider-shaped Go in the host: no CalDAVConfig, no url/username/password named here.
type credVaultAdapter struct{ repo *credentials.Repo }

func (a credVaultAdapter) Connected(
	ctx context.Context, blockID, ownerID string,
) (bool, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return false, fmt.Errorf("block cred vault connected: %w", err)
	}
	return conn.Connected, nil
}

func (a credVaultAdapter) Credentials(
	ctx context.Context, blockID, ownerID string,
) (json.RawMessage, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return nil, fmt.Errorf("block cred vault credentials: %w", err)
	}
	return conn.Credentials, nil
}

// seamStoreAdapter —— the credentials repo, narrowed to the one question SeamStore asks.
type seamStoreAdapter struct{ repo *credentials.Repo }

func (a seamStoreAdapter) ActiveSupplierID(
	ctx context.Context, ownerID, seam string,
) (string, error) {
	conns, err := a.repo.ListBySeam(ctx, ownerID, seam)
	if err != nil {
		return "", fmt.Errorf("active supplier id: %w", err)
	}
	for i := range conns {
		if conns[i].Active {
			return conns[i].BlockID, nil
		}
	}
	return "", nil
}
