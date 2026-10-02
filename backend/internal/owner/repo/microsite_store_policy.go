package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// StorePolicy —— the page's store policy; the defaults when the owner never set one.
func (r *MicrositeRepo) StorePolicy(
	ctx context.Context, pageID string,
) (entity.StorePolicy, error) {
	pg, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.StorePolicy{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.pool).GetMicrositeStorePolicy(ctx, pg)
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.DefaultStorePolicy, nil
	}
	if err != nil {
		return entity.StorePolicy{}, fmt.Errorf("store policy: %w", err)
	}
	return entity.StorePolicy{MaxDocs: row.MaxDocs, Review: row.Review}, nil
}

// SetStorePolicy —— replace the page's store policy.
func (r *MicrositeRepo) SetStorePolicy(
	ctx context.Context, pageID string, p entity.StorePolicy,
) error {
	pg, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return fmt.Errorf(errParsePageID, perr)
	}
	if err := db.New(r.pool).UpsertMicrositeStorePolicy(ctx, db.UpsertMicrositeStorePolicyParams{
		PageID: pg, MaxDocs: p.MaxDocs, Review: p.Review,
	}); err != nil {
		return fmt.Errorf("set store policy: %w", err)
	}
	return nil
}
