// legacy_migrate.go — the one-off move of credential values off
// block_connections.credentials_enc into the credential-manager (credmgr), run at every boot (a
// no-op once nothing is left).
//
// The value moved to credmgr when the block model retired the bespoke vault column
// (docs/design/plugin/access-control.md: "migrating today's rows is a one-off"). Rows written
// before that kept their value in the column and were copied over lazily, on first read, without
// the column ever being emptied: two copies of the owner's secret, and a read path with a
// fallback. This moves every such value once and empties the column, so credmgr is the only source.

package credentials

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials/db"
)

// MigrateLegacyCredentials — moves every legacy credential value into credmgr and empties its
// column. A blob that won't decrypt (the instance secret rotated) held no usable credential: its
// row is emptied and marked not connected, so the owner sees "reconnect" instead of a connection
// that fails on use. A value credmgr already holds wins (it was saved later).
func (r *Repo) MigrateLegacyCredentials(ctx context.Context) error {
	rows, err := db.New(r.pool).ListLegacyCredentialRows(ctx)
	if err != nil {
		return fmt.Errorf("list legacy credentials: %w", err)
	}
	for i := range rows {
		row := &rows[i]
		owner := pgstore.FormatUUID(row.OwnerID)
		disconnect, merr := moveLegacyValue(ctx, r.secrets, owner, row.BlockID, row.CredentialsEnc)
		if merr != nil {
			return merr
		}
		if cerr := db.New(r.pool).ClearLegacyCredentials(ctx, db.ClearLegacyCredentialsParams{
			Disconnect: disconnect, OwnerID: row.OwnerID, BlockID: row.BlockID,
		}); cerr != nil {
			return fmt.Errorf("clear legacy credentials %q: %w", row.BlockID, cerr)
		}
	}
	return nil
}

// moveLegacyValue — the decision for one row: put the decrypted value into credmgr unless credmgr
// already has one. The bool is "disconnect": the blob won't decrypt, there is nothing to move.
func moveLegacyValue(
	ctx context.Context, store SecretStore, owner, blockID string, enc []byte,
) (bool, error) {
	legacy, derr := decBytes(enc, []byte(owner))
	if errors.Is(derr, cryptobox.ErrTampered) {
		return true, nil
	}
	if derr != nil {
		return false, fmt.Errorf("decrypt legacy credentials %q: %w", blockID, derr)
	}
	return false, keepNewerOrStore(ctx, store, owner, blockID, string(legacy))
}

// keepNewerOrStore — a readable value already in credmgr was saved after the legacy one and wins;
// otherwise (absent, or no longer decrypting) the legacy value — the usable one — is stored.
func keepNewerOrStore(ctx context.Context, store SecretStore, owner, blockID, value string) error {
	current, gerr := store.Get(ctx, owner, blockID)
	if errors.Is(gerr, cryptobox.ErrTampered) {
		current, gerr = "", nil
	}
	if gerr != nil {
		return fmt.Errorf("read credentials %q: %w", blockID, gerr)
	}
	if current != "" {
		return nil
	}
	if serr := store.Set(ctx, owner, blockID, value); serr != nil {
		return fmt.Errorf("move legacy credentials %q: %w", blockID, serr)
	}
	return nil
}
