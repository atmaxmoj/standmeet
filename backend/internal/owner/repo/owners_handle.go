// owners_handle.go —— Repo's transactional path for changing handle. Split
// out of owners.go to keep that file under its 350-line cap.
//
// UpdateHandle atomically, in one shot, changes owners.handle to the new
// value + writes the old handle into handle_aliases, so old links still
// resolve (see internal/postgres/auth.go GetByHandle). A unique-constraint
// conflict translates to ErrHandleTaken.

package repo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// UpdateHandle —— owner changing handle is one atomic group: read the old
// handle, UPDATE owners with the new handle, write the old handle into
// handle_aliases. Done in one transaction; a unique-constraint conflict
// (handle taken by someone else) translates to ErrHandleTaken.
func (r *Repo) UpdateHandle(
	ctx context.Context, ownerID, newHandle string,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	var ownerRow entity.Owner
	if err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		var txErr error
		ownerRow, txErr = updateHandleTx(ctx, tx, pgID, newHandle)
		return txErr
	}); err != nil {
		return entity.Owner{}, err
	}
	return ownerRow, nil
}

func updateHandleTx(
	ctx context.Context, tx pgx.Tx, ownerID pgtype.UUID, newHandle string,
) (entity.Owner, error) {
	q := db.New(tx)
	old, gerr := q.GetOwnerByID(ctx, ownerID)
	if gerr != nil {
		return entity.Owner{}, fmt.Errorf("get owner: %w", gerr)
	}
	if old.Handle == newHandle {
		return toDomainOwner(&old), nil
	}
	if uerr := doUpdateHandle(ctx, q, ownerID, newHandle); uerr != nil {
		return entity.Owner{}, uerr
	}
	aliasParams := db.AddHandleAliasParams{Handle: old.Handle, OwnerID: ownerID}
	if aerr := q.AddHandleAlias(ctx, aliasParams); aerr != nil {
		return entity.Owner{}, fmt.Errorf("add alias: %w", aerr)
	}
	old.Handle = newHandle
	return toDomainOwner(&old), nil
}

func doUpdateHandle(
	ctx context.Context, q *db.Queries, ownerID pgtype.UUID, newHandle string,
) error {
	_, err := q.UpdateOwnerHandle(ctx, db.UpdateOwnerHandleParams{ID: ownerID, Handle: newHandle})
	if err == nil {
		return nil
	}
	constraint, isUnique := pgstore.UniqueViolation(err)
	if isUnique && constraint == "owners_handle_key" {
		return entity.ErrHandleTaken
	}
	return fmt.Errorf("update handle: %w", err)
}
