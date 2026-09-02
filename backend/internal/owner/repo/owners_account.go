// owners_account.go —— repo methods for owner self-service management of
// account fields (full_name / email / password). Split out of owners.go
// to keep that file under its 350-line max-lines cap.
//
// All three updates return the full Owner row (used by the frontend
// sessionStore mutate), matching the style of UpdatePublicURL /
// UpdateHandle.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// UpdateFullName —— the owner changes their own full_name; an empty
// string / all-whitespace is caught by the usecase layer, repo just
// trusts the plain string.
func (r *Repo) UpdateFullName(
	ctx context.Context, ownerID, newFullName string,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateOwnerFullName(ctx, db.UpdateOwnerFullNameParams{
		ID: pgID, FullName: newFullName,
	})
	if qerr != nil {
		return entity.Owner{}, fmt.Errorf("update full_name: %w", qerr)
	}
	return toDomainOwner(&row), nil
}

// UpdateProfileTimezone —— triggered by the admin booking-policy PATCH
// route; an empty string means "UTC".
func (r *Repo) UpdateProfileTimezone(
	ctx context.Context, ownerID, tz string,
) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	params := db.UpdateOwnerProfileTimezoneParams{ID: pgID, ProfileTimezone: tz}
	if _, qerr := q.UpdateOwnerProfileTimezone(ctx, params); qerr != nil {
		return fmt.Errorf("update profile_timezone: %w", qerr)
	}
	return nil
}

// UpdateEmail —— the owner changes their own email. A unique conflict
// translates to ErrEmailTaken, letting routes translate to 409. usecase
// must verify the current password first.
func (r *Repo) UpdateEmail(
	ctx context.Context, ownerID, newEmail string,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	// Normalization happens at this layer, not the caller's — see the
	// header comment in email.go.
	row, qerr := q.UpdateOwnerEmail(ctx, db.UpdateOwnerEmailParams{
		ID: pgID, Email: NormalizeEmail(newEmail),
	})
	if qerr != nil {
		return entity.Owner{}, translateEmailUpdateErr(qerr)
	}
	return toDomainOwner(&row), nil
}

func translateEmailUpdateErr(err error) error {
	constraint, isUnique := pgstore.UniqueViolation(err)
	if isUnique && constraint == "owners_email_key" {
		return entity.ErrEmailTaken
	}
	return fmt.Errorf("update email: %w", err)
}

// UpdatePasswordHash —— writes the owner's password_hash; usecase must
// verify the old password first + call HashPassword(newPlaintext) outside
// to get the PHC string.
func (r *Repo) UpdatePasswordHash(
	ctx context.Context, ownerID, newHash string,
) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	if _, qerr := q.UpdateOwnerPasswordHash(ctx, db.UpdateOwnerPasswordHashParams{
		ID: pgID, PasswordHash: newHash,
	}); qerr != nil {
		return fmt.Errorf("update password_hash: %w", qerr)
	}
	return nil
}

// SetRecoveryHash —— #100 writes the owner's recovery_hash (usecase calls
// HashPassword(phrase) outside this).
func (r *Repo) SetRecoveryHash(ctx context.Context, ownerID, hash string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	if qerr := db.New(r.pool).SetOwnerRecoveryHash(ctx, db.SetOwnerRecoveryHashParams{
		ID: pgID, RecoveryHash: hash,
	}); qerr != nil {
		return fmt.Errorf("set recovery_hash: %w", qerr)
	}
	return nil
}

// ClearRecoveryHash —— #100 invalidates it after a successful recover
// (single-use).
func (r *Repo) ClearRecoveryHash(ctx context.Context, ownerID string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	if qerr := db.New(r.pool).ClearOwnerRecoveryHash(ctx, pgID); qerr != nil {
		return fmt.Errorf("clear recovery_hash: %w", qerr)
	}
	return nil
}

// GetPasswordHash —— gets the owner's current password_hash, for usecase
// to verify the old password. Returns ErrOwnerNotFound if not found.
func (r *Repo) GetPasswordHash(ctx context.Context, ownerID string) (string, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return "", fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	hash, err := q.GetOwnerPasswordHash(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return "", entity.ErrOwnerNotFound
		}
		return "", fmt.Errorf("get owner password_hash: %w", err)
	}
	return hash, nil
}

// ActiveResetToken —— the sole owner's currently active password-reset
// info. Empty Hash + zero IssuedAt means no active token; usecase uses
// this to decide ErrUnauthorized.
type ActiveResetToken struct {
	IssuedAt time.Time
	OwnerID  string
	Hash     []byte
}

// GetActiveResetToken —— single-owner self-host: the reset-token info of
// the table's first owner row. Returns ErrOwnerNotFound if the table is
// empty (the caller usually translates that to 401).
func (r *Repo) GetActiveResetToken(ctx context.Context) (ActiveResetToken, error) {
	q := db.New(r.pool)
	row, err := q.GetFirstOwnerResetToken(ctx)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return ActiveResetToken{}, entity.ErrOwnerNotFound
		}
		return ActiveResetToken{}, fmt.Errorf("get reset token row: %w", err)
	}
	out := ActiveResetToken{
		OwnerID: pgstore.FormatUUID(row.ID),
		Hash:    row.PasswordResetHash,
	}
	if row.PasswordResetAt.Valid {
		out.IssuedAt = row.PasswordResetAt.Time
	}
	return out, nil
}

// ClearPasswordResetToken —— clears hash + at after a successful reset,
// making the token single-use.
func (r *Repo) ClearPasswordResetToken(ctx context.Context, ownerID string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	if cerr := q.ClearPasswordResetToken(ctx, pgID); cerr != nil {
		return fmt.Errorf("clear reset token: %w", cerr)
	}
	return nil
}

// SoleOwnerHandle —— used by the `standmeet password-reset` CLI: the sole
// owner's id + public_url (used to build the reset URL). Returns
// ErrOwnerNotFound if the table is empty.
type SoleOwnerHandle struct {
	OwnerID   string
	PublicURL string
}

// GetSoleOwnerHandle —— used by the CLI password-reset subcommand + any
// helper that just wants to know "who is the sole owner". Combines
// GetFirstOwnerResetToken + GetOwnerByID.
func (r *Repo) GetSoleOwnerHandle(ctx context.Context) (SoleOwnerHandle, error) {
	q := db.New(r.pool)
	tok, err := q.GetFirstOwnerResetToken(ctx)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return SoleOwnerHandle{}, entity.ErrOwnerNotFound
		}
		return SoleOwnerHandle{}, fmt.Errorf("get sole owner row: %w", err)
	}
	ownerRow, gerr := q.GetOwnerByID(ctx, tok.ID)
	if gerr != nil {
		return SoleOwnerHandle{}, fmt.Errorf("get owner by id: %w", gerr)
	}
	return SoleOwnerHandle{
		OwnerID:   pgstore.FormatUUID(tok.ID),
		PublicURL: ownerRow.PublicUrl,
	}, nil
}

// SetPasswordResetHash —— called when the CLI issues a reset token; writes
// hash + the current timestamp. Calling it again overwrites the old
// token, consistent with SQL semantics (re-running the command is valid
// UX).
func (r *Repo) SetPasswordResetHash(
	ctx context.Context, ownerID string, hash []byte,
) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	if serr := q.SetPasswordResetToken(ctx, db.SetPasswordResetTokenParams{
		ID: pgID, PasswordResetHash: hash,
	}); serr != nil {
		return fmt.Errorf("set reset token: %w", serr)
	}
	return nil
}

// GetCSS —— the owner's custom CSS (the safe version, after
// sanitize+scope).
func (r *Repo) GetCSS(ctx context.Context, ownerID string) (string, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return "", fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	css, err := db.New(r.pool).GetOwnerCSS(ctx, pgID)
	if err != nil {
		return "", fmt.Errorf("get owner css: %w", err)
	}
	return css, nil
}

// SetCSS —— stores the owner's CSS (the caller should have already
// sanitized+scoped it).
func (r *Repo) SetCSS(ctx context.Context, ownerID, css string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	err := db.New(r.pool).SetOwnerCSS(ctx, db.SetOwnerCSSParams{ID: pgID, CustomCss: css})
	if err != nil {
		return fmt.Errorf("set owner css: %w", err)
	}
	return nil
}
