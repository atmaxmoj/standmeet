// login.go — the owner login use case: verify password + issue a session.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// LoginDeps bundles the dependencies Login needs.
type LoginDeps struct {
	Owners   *repo.Repo
	Sessions *session.OwnerSessionStore
}

// LoginInput is the input to Login. ClientIP + UserAgent are captured from the
// HTTP request so the active-sessions panel can show where each login came from.
type LoginInput struct {
	Email     string
	Password  string
	ClientIP  string
	UserAgent string
}

// LoginOutput returns the plaintext session token + csrf token; the handler uses these
// to write the cookie. OwnerHandle lets the frontend redirect to /<handle> immediately,
// saving an extra /me call.
type LoginOutput struct {
	SessionToken string
	CSRFToken    string
	OwnerID      string
	OwnerHandle  string
}

// Login verifies the password and issues a session. Both a wrong password and a
// nonexistent user return ErrUnauthorized (not distinguishing "user doesn't exist" vs.
// "wrong password" avoids leaking existence).
func Login(ctx context.Context, deps LoginDeps, in *LoginInput) (LoginOutput, error) {
	if in.Email == "" || in.Password == "" {
		return LoginOutput{}, apierr.ErrEmptyField
	}
	creds, err := authenticate(ctx, deps, in)
	if err != nil {
		return LoginOutput{}, err
	}
	issued, err := deps.Sessions.Issue(ctx, creds.OwnerID, in.ClientIP, in.UserAgent)
	if err != nil {
		return LoginOutput{}, fmt.Errorf("issue session: %w", err)
	}
	// Pair with claim's "owner_id" log so the test-time timeline reads:
	// claim → owner_id X → login → same owner_id X → create token → ...
	slog.Default().Info("login succeeded",
		"owner_id", creds.OwnerID, "email", in.Email, "handle", creds.Handle)
	return LoginOutput{
		SessionToken: issued.Token,
		CSRFToken:    issued.Data.CSRFToken,
		OwnerID:      creds.OwnerID,
		OwnerHandle:  creds.Handle,
	}, nil
}

// authenticate pulls the password-checking part out of Login, keeping Login itself at
// cognitive-complexity <= 7.
func authenticate(
	ctx context.Context, deps LoginDeps, in *LoginInput,
) (repo.Credentials, error) {
	creds, err := deps.Owners.GetCredentialsByEmail(ctx, in.Email)
	if err != nil {
		if errors.Is(err, entity.ErrOwnerNotFound) {
			return repo.Credentials{}, entity.ErrUnauthorized
		}
		return repo.Credentials{}, fmt.Errorf("get credentials: %w", err)
	}
	if verr := session.VerifyPassword(in.Password, creds.PasswordHash); verr != nil {
		if errors.Is(verr, session.ErrPasswordMismatch) {
			return repo.Credentials{}, entity.ErrUnauthorized
		}
		return repo.Credentials{}, fmt.Errorf("verify password: %w", verr)
	}
	return creds, nil
}
