// account.go — the usecase for an owner self-managing account fields
// (full_name / email / password). email + password changes must verify the
// current password first — this stops an attacker who borrowed a session from
// hijacking the account outright.
//
// Password verification reuses session.VerifyPassword (Argon2id constant-time
// compare); any verification failure returns ErrUnauthorized, the same code as
// login, so an attacker isn't told which step failed.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// AccountDeps — dependencies for UpdateOwnerFullName / Email / Password.
type AccountDeps struct {
	Owners *repo.Repo
}

const (
	minPasswordLen = 12
	maxFullNameLen = 200
	maxEmailLen    = 320 // RFC 5321
)

// ErrPasswordTooShort — the new password is too short; the usecase maps this to
// 400, and routes go through envBadReq so the frontend can show an inline hint.
var ErrPasswordTooShort = errors.New("password must be at least 12 characters")

// UpdateOwnerFullName — owner changes full_name. Trim + 200-char cap; empty
// returns apierr.ErrEmptyField. No password check needed (low-stake).
func UpdateOwnerFullName(
	ctx context.Context, deps AccountDeps, ownerID, raw string,
) (entity.Owner, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return entity.Owner{}, apierr.ErrEmptyField
	}
	if len(trimmed) > maxFullNameLen {
		return entity.Owner{}, fmt.Errorf(
			"%w: full_name too long (max %d)", apierr.ErrEmptyField, maxFullNameLen,
		)
	}
	updated, err := deps.Owners.UpdateFullName(ctx, ownerID, trimmed)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("update full_name: %w", err)
	}
	return updated, nil
}

// EmailUpdateInput — bundles UpdateOwnerEmail's ownerID + the two fields.
type EmailUpdateInput struct {
	OwnerID         string
	CurrentPassword string
	NewEmail        string
}

// UpdateOwnerEmail — owner changes email. Verify the current password first;
// only proceed on success. The new email goes through trim + length + basic
// format check (exactly one '@'); a uniqueness conflict maps to ErrEmailTaken.
func UpdateOwnerEmail(
	ctx context.Context, deps AccountDeps, in *EmailUpdateInput,
) (entity.Owner, error) {
	if verr := verifyCurrentPassword(ctx, deps, in.OwnerID, in.CurrentPassword); verr != nil {
		return entity.Owner{}, verr
	}
	normalized, nerr := normalizeEmail(in.NewEmail)
	if nerr != nil {
		return entity.Owner{}, nerr
	}
	updated, err := deps.Owners.UpdateEmail(ctx, in.OwnerID, normalized)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("update email: %w", err)
	}
	return updated, nil
}

// normalizeEmail is **validation**, not where normalization is defined. The
// normalization rule lives in `repo.NormalizeEmail` (the single choke point
// emails pass through on the way in and out of the database); this function
// only measures with that same ruler before checking format — otherwise "the
// string that passed validation" and "the string that got stored" would be
// two different things. Do not reimplement trim/lower here.
func normalizeEmail(raw string) (string, error) {
	trimmed := repo.NormalizeEmail(raw)
	if trimmed == "" {
		return "", apierr.ErrEmptyField
	}
	if len(trimmed) > maxEmailLen {
		return "", fmt.Errorf("%w: email too long", apierr.ErrEmptyField)
	}
	if !validEmail(trimmed) {
		return "", fmt.Errorf("%w: email format invalid", apierr.ErrEmptyField)
	}
	return trimmed, nil
}

// validEmail — the loosest format check: exactly one '@' with non-empty sides.
// The frontend adds tighter constraints.
func validEmail(s string) bool {
	parts := strings.Split(s, "@")
	if len(parts) != 2 {
		return false
	}
	return parts[0] != "" && parts[1] != "" && strings.Contains(parts[1], ".")
}

// PasswordUpdateInput — input for UpdateOwnerPassword.
type PasswordUpdateInput struct {
	OwnerID         string
	CurrentPassword string
	NewPassword     string
}

// UpdateOwnerPassword — owner changes password. Verify the current password
// first + check the new password's length >= minPasswordLen, then
// HashPassword + repo write. Returns OK, not Owner (password doesn't go into
// /me, doesn't touch sessionStore; the token isn't even refreshed, so the old
// session stays valid).
func UpdateOwnerPassword(
	ctx context.Context, deps AccountDeps, in *PasswordUpdateInput,
) error {
	if verr := verifyCurrentPassword(ctx, deps, in.OwnerID, in.CurrentPassword); verr != nil {
		return verr
	}
	if len(in.NewPassword) < minPasswordLen {
		return ErrPasswordTooShort
	}
	hash, herr := session.HashPassword(in.NewPassword)
	if herr != nil {
		return fmt.Errorf("hash new password: %w", herr)
	}
	if uerr := deps.Owners.UpdatePasswordHash(ctx, in.OwnerID, hash); uerr != nil {
		return fmt.Errorf("update password_hash: %w", uerr)
	}
	return nil
}

// verifyCurrentPassword — takes ownerID + plaintext password, has repo fetch
// the hash, then session.VerifyPassword does a constant-time compare. Any
// failure maps to ErrUnauthorized — it does not distinguish "user exists" /
// "hash parse failed" / "wrong password".
func verifyCurrentPassword(
	ctx context.Context, deps AccountDeps, ownerID, plaintext string,
) error {
	if plaintext == "" {
		return entity.ErrUnauthorized
	}
	hash, err := deps.Owners.GetPasswordHash(ctx, ownerID)
	if err != nil {
		return entity.ErrUnauthorized
	}
	if verr := session.VerifyPassword(plaintext, hash); verr != nil {
		return entity.ErrUnauthorized
	}
	return nil
}
