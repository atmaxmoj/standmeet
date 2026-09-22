// homepage_singleton.go — the reserved `home` page is a SINGLETON: exactly one row per owner,
// created once, restored (never re-created) if soft-deleted, and never deletable (DeletePage
// refuses it). The DB backs this with a unique index on (owner_id) WHERE slug='home', so a second
// home row can't exist even if a caller bypasses this usecase; EnsureHomepage is the graceful
// front door that turns "create" into get-or-restore instead of hitting that index.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

const statusDeleted = "deleted"

// homePageStore — the three home-row operations EnsureHomepage needs. *repo.MicrositeRepo
// satisfies it; the narrow interface is what lets the get-or-restore policy be tested with a fake.
type homePageStore interface {
	// GetBySlugAny — the row for (owner, slug) in ANY status (including 'deleted'), or
	// entity.ErrMicrositeNotFound. Unlike GetBySlug, it can see a soft-deleted home to restore it.
	GetBySlugAny(ctx context.Context, ownerID, slug string) (entity.Microsite, error)
	Create(ctx context.Context, ownerID, slug, title string) (entity.Microsite, error)
	// Restore — un-delete the (owner, slug) row (status → 'active'), returning it.
	Restore(ctx context.Context, ownerID, slug string) (entity.Microsite, error)
}

// EnsureHomepage — get-or-restore the single home row for this owner. Never inserts a second:
//   - no home row        → create it,
//   - soft-deleted home  → restore it in place (so no tombstone is ever left behind),
//   - a live home already → return it unchanged (idempotent).
//
// A lookup failure that is NOT "not found" propagates: mistaking it for "absent" would insert a
// duplicate the moment the DB recovered.
func EnsureHomepage(
	ctx context.Context, pages homePageStore, ownerID string,
) (entity.Microsite, error) {
	existing, err := pages.GetBySlugAny(ctx, ownerID, HomepageSlug)
	if errors.Is(err, entity.ErrMicrositeNotFound) {
		page, cerr := pages.Create(ctx, ownerID, HomepageSlug, defaultHomepageTitle)
		return page, wrapEnsure("create", cerr)
	}
	if err != nil {
		return entity.Microsite{}, fmt.Errorf("ensure homepage lookup: %w", err)
	}
	if existing.Status == statusDeleted {
		page, rerr := pages.Restore(ctx, ownerID, HomepageSlug)
		return page, wrapEnsure("restore", rerr)
	}
	return existing, nil
}

func wrapEnsure(step string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("ensure homepage %s: %w", step, err)
}
