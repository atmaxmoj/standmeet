// microsite_store_writable.go — the microsites.store_writable flag (model C): whether it accepts
// visitor writes. Kept out of microsites.go to hold that file under max-lines.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
)

// (GetStoreWritable is not needed: GetBySlug already returns the page's StoreWritable field.)

// SetStoreWritable opens or closes a page's store to visitor writes, scoped to (owner, slug).
func (r *MicrositeRepo) SetStoreWritable(
	ctx context.Context, ownerID, slug string, writable bool,
) error {
	oid, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf("parse owner id: %w", perr)
	}
	if err := db.New(r.pool).SetMicrositeStoreWritable(ctx, db.SetMicrositeStoreWritableParams{
		OwnerID: oid, Slug: slug, StoreWritable: writable,
	}); err != nil {
		return fmt.Errorf("set store writable: %w", err)
	}
	return nil
}
