// page_save.go — the rules **for reading one home page's content and saving one home
// page's content**, in themselves.
//
// Two rules used to live on a surface:
//
//   - When there's no content yet, hand back a default draft (the owner edits from that,
//     rather than starting from a blank slate).
//   - Before saving, validate the pin list: every pin must be published (pinned ⊆ published).
//
// It's the same regardless of who's saving, so it lives in the domain.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PageContentOrDefault — the current content; if there is none yet, hand back a
// default draft.
func PageContentOrDefault(
	ctx context.Context, owners *repo.Repo, ownerID string,
) (entity.PageContent, error) {
	content, err := owners.GetPageContent(ctx, ownerID)
	if err == nil {
		return content, nil
	}
	if errors.Is(err, entity.ErrPageNotFound) {
		return DefaultPageContent(ownerID), nil
	}
	return entity.PageContent{}, fmt.Errorf("read page content: %w", err)
}

// SavePageContent — validates the pin list, then saves the whole thing.
func SavePageContent(
	ctx context.Context, pins PagePinDeps, ownerID string, content *entity.PageContent,
) (entity.PageContent, error) {
	content.OwnerID = ownerID
	if err := ValidatePagePins(ctx, pins, ownerID, content); err != nil {
		return entity.PageContent{}, fmt.Errorf("validate page pins: %w", err)
	}
	saved, err := pins.Owners.UpsertPageContent(ctx, ownerID, content)
	if err != nil {
		return entity.PageContent{}, fmt.Errorf("save page content: %w", err)
	}
	return saved, nil
}
