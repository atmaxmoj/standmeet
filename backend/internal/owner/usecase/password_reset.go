// password_reset.go — the usecase for an emergency password reset.
//
// Flow:
//   1. The operator runs the `standmeet password-reset` subcommand on the server ->
//      generates a 32-byte token, stores its SHA-256 hash in
//      owners.password_reset_hash, sets password_reset_at = NOW(). stdout prints the
//      plaintext + URL.
//   2. The owner opens the URL -> /account/reset?t=... -> the frontend reads t + takes
//      a new password -> POST /api/v1/account/reset-password { token, new_password }.
//   3. This usecase: finds the sole owner, checks the TTL (<= 30min), does a SHA-256
//      const-time comparison, and on success does HashPassword(new) +
//      repo.UpdatePasswordHash + clear.
//
// Any failure returns ErrUnauthorized across the board (never telling apart wrong token
// vs. expired vs. already used).

package usecase

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PasswordResetDeps — dependencies for ConsumePasswordResetToken.
type PasswordResetDeps struct {
	Owners *repo.Repo
}

// PasswordResetTTL — how long the token stays valid after issuance; the CLI stdout
// and the frontend / docs must display this value. 30min gives the operator enough time
// to switch from the server back to a browser; any longer widens an attacker's
// brute-force window.
const PasswordResetTTL = 30 * time.Minute

// ConsumePasswordResetToken — takes the plaintext token + new password: verify +
// change password + clear. Any step failing returns ErrUnauthorized uniformly;
// ErrPasswordTooShort is kept separate for the frontend's inline hint (a too-short
// password isn't an "auth failure").
func ConsumePasswordResetToken(
	ctx context.Context, deps PasswordResetDeps, tokenPlaintext, newPassword string,
) error {
	if len(newPassword) < minPasswordLen {
		return ErrPasswordTooShort
	}
	if tokenPlaintext == "" {
		return entity.ErrUnauthorized
	}
	resetToken, err := deps.Owners.GetActiveResetToken(ctx)
	if err != nil {
		return fmt.Errorf("load reset token: %w", err)
	}
	if !matchesAndFresh(tokenPlaintext, resetToken.Hash, resetToken.IssuedAt) {
		return entity.ErrUnauthorized
	}
	return applyNewPassword(ctx, deps, resetToken.OwnerID, newPassword)
}

func matchesAndFresh(plaintext string, hash []byte, issuedAt time.Time) bool {
	if len(hash) == 0 || issuedAt.IsZero() {
		return false
	}
	if time.Since(issuedAt) > PasswordResetTTL {
		return false
	}
	sum := sha256.Sum256([]byte(plaintext))
	return subtle.ConstantTimeCompare(sum[:], hash) == 1
}

func applyNewPassword(
	ctx context.Context, deps PasswordResetDeps, ownerID, newPassword string,
) error {
	newHash, herr := session.HashPassword(newPassword)
	if herr != nil {
		return fmt.Errorf("hash new password: %w", herr)
	}
	if uerr := deps.Owners.UpdatePasswordHash(ctx, ownerID, newHash); uerr != nil {
		return fmt.Errorf("update password_hash: %w", uerr)
	}
	if cerr := deps.Owners.ClearPasswordResetToken(ctx, ownerID); cerr != nil {
		return fmt.Errorf("clear reset token: %w", cerr)
	}
	return nil
}

// ErrNoActiveResetToken — the sole owner has no issued reset token; the caller should
// translate this to ErrUnauthorized. Exported so repo implementations can return it.
var ErrNoActiveResetToken = errors.New("no active password reset token")
