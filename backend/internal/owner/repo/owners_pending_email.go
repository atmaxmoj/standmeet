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

// StartPendingEmail —— records the new pending email + token hash + expiry, and in the same
// transaction the job that mails its confirmation: enqueue gets the transaction and returns the
// job id, stored on the row so the panel can show the send state. The pending change exists if
// and only if its confirmation is on its way.
//
// A second call simply overwrites the first: if both links stayed valid,
// the owner would think the change went to the second one, while an old
// tab clicked later would send the identity to the first one.
func (r *Repo) StartPendingEmail(
	ctx context.Context, p *PendingEmailStart, enqueue func(tx pgstore.Tx) (int64, error),
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(p.OwnerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	// Normalization happens in repo — see email.go. The pending address is
	// destined to become the email column, so both must use the same
	// yardstick.
	normalized := NormalizeEmail(p.NewEmail)
	var out entity.Owner
	err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		q := db.New(tx)
		row, qerr := q.SetOwnerPendingEmail(ctx, db.SetOwnerPendingEmailParams{
			ID:                    pgID,
			PendingEmail:          &normalized,
			PendingEmailTokenHash: p.TokenHash,
			PendingEmailExpiresAt: pgtype.Timestamptz{Time: p.ExpiresAt, Valid: true},
		})
		if qerr != nil {
			return fmt.Errorf("set pending email: %w", qerr)
		}
		job, jerr := enqueue(tx)
		if jerr != nil {
			return jerr
		}
		row.PendingEmailJobID = &job
		out = toDomainOwner(&row)
		_, qerr = q.SetOwnerPendingEmailJob(ctx, db.SetOwnerPendingEmailJobParams{
			ID: pgID, PendingEmail: &normalized, PendingEmailJobID: &job,
		})
		return qerr //nolint:wrapcheck // the only statement left; the tx error names it
	})
	return out, err //nolint:wrapcheck // InTx names begin/commit; the steps name themselves
}

// PendingEmailStart —— one pending email change to record.
type PendingEmailStart struct {
	ExpiresAt time.Time
	OwnerID   string
	NewEmail  string
	TokenHash string
}

// RotatePendingEmailToken —— the confirmation job's fresh token hash, only while this exact
// change is still pending and unexpired. false = cancelled, replaced or expired: send nothing.
func (r *Repo) RotatePendingEmailToken(
	ctx context.Context, ownerID, email, tokenHash string,
) (bool, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return false, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	normalized := NormalizeEmail(email)
	params := db.RotateOwnerPendingEmailTokenParams{
		ID: pgID, PendingEmail: &normalized, PendingEmailTokenHash: tokenHash,
	}
	n, err := db.New(r.pool).RotateOwnerPendingEmailToken(ctx, params)
	if err != nil {
		return false, fmt.Errorf("rotate pending email token: %w", err)
	}
	return n > 0, nil
}

// ConfirmPendingEmail —— swaps identity only if the token matches and
// hasn't expired; on success it clears all three columns (single-use).
// Hitting 0 rows → ErrPendingEmailNotFound, and the layer above decides
// whether it was expired or simply invalid.
func (r *Repo) ConfirmPendingEmail(
	ctx context.Context, tokenHash string,
) (entity.Owner, error) {
	row, err := db.New(r.conn()).ConfirmOwnerPendingEmail(ctx, tokenHash)
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
