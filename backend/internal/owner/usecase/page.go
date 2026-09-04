// page.go — the sole-owner lookup + the unclaimed setup-token path.
//
// After the handle-URL removal: every "resolve owner by handle" path collapsed down to
// "fetch the sole owner" — public page / wiki landing / custom page all now go through
// LoadSoleOwner.
//
// The owner's public homepage is now a custom page (the reserved `home` slug), not
// built-in page_content — so GetPublicPage / the pin-joined view are gone.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PageDeps — what the sole-owner lookup needs.
type PageDeps struct {
	Owners *repo.Repo
}

// LoadSoleOwner — v1 single-owner instance: fetches the one owner. pre-claim
// (not yet claimed) -> ErrOwnerNotFound. The app root path / SEO / public routes all
// go through this.
func LoadSoleOwner(ctx context.Context, deps PageDeps) (entity.Owner, error) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("first owner handle: %w", err)
	}
	if handle == "" {
		return entity.Owner{}, entity.ErrOwnerNotFound
	}
	sole, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return entity.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return sole, nil
}

// SetupTokenIssuer — the minimal interface EnsureUnclaimedSetupToken needs (wraps
// session.IssueSetupToken + InstanceRepo). Keeps the usecase layer from importing the
// session package -> which belongs to the routes layer.
type SetupTokenIssuer interface {
	// UsableToken — the plaintext that **can genuinely claim right now**; returns an
	// empty string if there isn't one.
	//
	// This is not two independent questions of "does a hash exist" plus "is the holder
	// non-empty" (F-L-56): even when both are true, they can still be mismatched — memory
	// holding TA while the DB holds hash(TB). The link that went out then 401s while both
	// questions answer "all good", and self-healing never triggers.
	// There's exactly one criterion: **does hashing the plaintext I'm holding equal the
	// hash in the DB**.
	UsableToken(ctx context.Context) (string, error)
	// IssueAndStore — generates a new plaintext + writes the DB hash + writes the holder,
	// returns the new plaintext. Returning it directly rather than making the caller ask
	// the holder again: an extra call in between would reopen a window for interleaving.
	IssueAndStore(ctx context.Context) (string, error)
}

// EnsureUnclaimedSetupToken — called by the /api/v1/instance handler during the
// unclaimed period; returns a setup_token plaintext guaranteed to be usable (so the
// frontend can redirect to /setup?t=...).
//
// The decision tree has only two branches:
//   - The plaintext in hand hashes to the same value as the DB's hash -> use it
//   - Everything else (hash is NULL / holder is empty / **the two halves don't match**)
//     -> issue a fresh one
//
// The third case is the one actually hit in a real environment, and it **does not heal
// itself**: the owner's `/setup?t=...` link keeps 401ing until someone restarts the
// backend. Self-hosting dies right here, in its first minute.
func EnsureUnclaimedSetupToken(ctx context.Context, issuer SetupTokenIssuer) (string, error) {
	usable, err := issuer.UsableToken(ctx)
	if err != nil {
		return "", fmt.Errorf("check setup token: %w", err)
	}
	if usable != "" {
		return usable, nil
	}
	fresh, ierr := issuer.IssueAndStore(ctx)
	if ierr != nil {
		return "", fmt.Errorf("issue setup token: %w", ierr)
	}
	return fresh, nil
}
