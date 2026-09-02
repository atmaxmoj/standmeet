// owners_pending_email.go —— the pending email-change flow: write /
// confirm / clear / read.
//
// All three methods use :one + RETURNING, not :exec. The reason is
// [[write-with-no-receipt]]: an UPDATE hitting 0 rows **does not error**,
// and :exec discards the row count too — so "confirmed" would be a lie.
// Here, hitting 0 rows is exactly the signal that matters most (bad token
// / expired / already used), so it must surface as ErrNoRows.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// SetPendingEmail —— records the new pending email + token hash + expiry.
// A second call simply overwrites the first: if both links stayed valid,
// the owner would think the change went to the second one, while an old
// tab clicked later would send the identity to the first one.
func (r *Repo) SetPendingEmail(
	ctx context.Context, ownerID, newEmail, tokenHash string, expiresAt time.Time,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	// Normalization happens in repo — see email.go. The pending address is
	// destined to become the email column, so both must use the same
	// yardstick.
	normalized := NormalizeEmail(newEmail)
	row, qerr := db.New(r.pool).SetOwnerPendingEmail(ctx, db.SetOwnerPendingEmailParams{
		ID:                    pgID,
		PendingEmail:          &normalized,
		PendingEmailTokenHash: tokenHash,
		PendingEmailExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if qerr != nil {
		return entity.Owner{}, fmt.Errorf("set pending email: %w", qerr)
	}
	return toDomainOwner(&row), nil
}

// ConfirmPendingEmail —— swaps identity only if the token matches and
// hasn't expired; on success it clears all three columns (single-use).
// Hitting 0 rows → ErrPendingEmailNotFound, and the layer above decides
// whether it was expired or simply invalid.
func (r *Repo) ConfirmPendingEmail(
	ctx context.Context, tokenHash string,
) (entity.Owner, error) {
	row, err := db.New(r.pool).ConfirmOwnerPendingEmail(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrPendingEmailNotFound
		}
		return entity.Owner{}, translateEmailUpdateErr(err)
	}
	return toDomainOwner(&row), nil
}

// PendingEmailChange —— one pending change. Owner + expiry are bundled
// together, because a function can return at most two values comfortably
// (revive function-result-limit), and these two belong to the same thing
// anyway.
type PendingEmailChange struct {
	ExpiresAt time.Time
	Owner     entity.Owner
}

// FindByPendingToken —— exists solely to tell "expired" apart from
// "never valid at all". Neither case swaps identity, but what's said to
// the owner differs, and what they should do next depends on that
// distinction.
func (r *Repo) FindByPendingToken(
	ctx context.Context, tokenHash string,
) (PendingEmailChange, error) {
	row, err := db.New(r.pool).GetOwnerByPendingToken(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PendingEmailChange{}, entity.ErrPendingEmailNotFound
		}
		return PendingEmailChange{}, fmt.Errorf("find by pending token: %w", err)
	}
	return PendingEmailChange{
		Owner: toDomainOwner(&row), ExpiresAt: row.PendingEmailExpiresAt.Time,
	}, nil
}

// ClearPendingEmail —— the owner changes their mind. Once cleared, the
// link in that email is dead too (its token hash is gone).
func (r *Repo) ClearPendingEmail(ctx context.Context, ownerID string) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	row, err := db.New(r.pool).ClearOwnerPendingEmail(ctx, pgID)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("clear pending email: %w", err)
	}
	return toDomainOwner(&row), nil
}
