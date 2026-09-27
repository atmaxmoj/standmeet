// microsites_clearlive.go —— ClearLive and With, split out to keep microsites.go under the line
// cap.

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

// ClearLive —— unpublish completely: null out both live and previous, so the page serves nothing
// (the homepage then falls through to the built-in DefaultHome). The build artifacts are kept.
func (r *MicrositeRepo) ClearLive(
	ctx context.Context, pageID string) (entity.Microsite, error,
) {
	pgID, perr := pgstore.ParseUUID(pageID)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf(errParsePageID, perr)
	}
	row, err := db.New(r.conn()).ClearMicrositeLive(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Microsite{}, entity.ErrMicrositeNotFound
		}
		return entity.Microsite{}, fmt.Errorf("clear live: %w", err)
	}
	return toDomainMicrosite(&row), nil
}

// With —— a copy whose live-pointer writes (SetLive / Rollback / ClearLive) run on q.
func (r *MicrositeRepo) With(q pgstore.DBTX) *MicrositeRepo {
	return &MicrositeRepo{pool: r.pool, q: q}
}

// Pool —— the pool a use case opens its transaction on.
func (r *MicrositeRepo) Pool() *pgstore.Pool { return r.pool }

// conn —— the transaction when bound by With, else the pool.
//
//nolint:ireturn // DBTX is the port both a pool and a transaction satisfy
func (r *MicrositeRepo) conn() pgstore.DBTX {
	if r.q != nil {
		return r.q
	}
	return r.pool
}
