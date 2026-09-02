// owner_public_url.go — the usecase for an owner changing the deployment's canonical
// public URL. Validation matches claim: must be http(s):// + non-empty host. normalize
// strips the trailing slash.
// QR / SEO canonical both use owner.public_url as their single source — see
// buildQRURL in applications.go.

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PublicURLDeps — dependencies for UpdateOwnerPublicURL.
type PublicURLDeps struct {
	Owners *repo.Repo
}

// UpdateOwnerPublicURL — the entry point for admin's "change public URL". raw goes
// through trim/normalize then a scheme check; on success, writes to DB and returns the
// new owner row.
// Reuses ErrPublicURLInvalid (the same sentinel as claim) so routes can translate it to 400.
func UpdateOwnerPublicURL(
	ctx context.Context, deps PublicURLDeps, ownerID, raw string,
) (entity.Owner, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return entity.Owner{}, apierr.ErrEmptyField
	}
	if !ValidPublicURL(trimmed) {
		return entity.Owner{}, ErrPublicURLInvalid
	}
	normalized := NormalizePublicURL(trimmed)
	updated, err := deps.Owners.UpdatePublicURL(ctx, ownerID, normalized)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("update public_url: %w", err)
	}
	return updated, nil
}
