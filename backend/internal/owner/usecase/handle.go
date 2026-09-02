// handle.go — the usecase for an owner changing their handle. Validate + hand off to
// repo (repo's own tx guarantees an atomic UPDATE owners + INSERT handle_aliases).

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// HandleDeps — dependencies for UpdateOwnerHandle.
type HandleDeps struct {
	Owners *repo.Repo
}

const (
	maxHandleLen = 64
	minHandleLen = 2
)

// UpdateOwnerHandle — the entry point for admin's "change handle". Validation: a-z0-9- +
// 2-64 chars; if the new handle matches the old one, just return the current one. Returns
// ErrHandleTaken so routes can translate it to 409.
func UpdateOwnerHandle(
	ctx context.Context, deps HandleDeps, ownerID, raw string,
) (entity.Owner, error) {
	h := strings.ToLower(strings.TrimSpace(raw))
	if !validHandle(h) {
		return entity.Owner{}, fmt.Errorf("%w: handle must be %d-%d chars of a-z0-9-",
			apierr.ErrEmptyField, minHandleLen, maxHandleLen)
	}
	updated, err := deps.Owners.UpdateHandle(ctx, ownerID, h)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("update handle: %w", err)
	}
	return updated, nil
}

func validHandle(h string) bool {
	if len(h) < minHandleLen || len(h) > maxHandleLen {
		return false
	}
	for _, r := range h {
		if !isHandleChar(r) {
			return false
		}
	}
	return true
}

func isHandleChar(r rune) bool {
	if r == '-' {
		return true
	}
	return isLowerAlnum(r)
}
