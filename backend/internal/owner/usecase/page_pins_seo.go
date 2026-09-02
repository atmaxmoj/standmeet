// page_pins_seo.go — where the publish toggle and the pin invariant meet.
//
// The unpublish side of pinned ⊆ published: both entry points that change wiki
// published (admin PATCH /corpus/wiki/{id}/seo and MCP seo.set_wiki_seo) must go
// through UpdateWikiSEOWithPins, never call repo directly — unpublishing an already-pinned
// entry succeeds + auto-unpins, and the sections it was removed from are returned to the
// caller to write into the response/tool result (the side effect is declared up front,
// never hidden).
//
// vault sync is the third path that writes published (frontmatter can flip publish); it
// calls SweepPagePins after a batch reconcile to clean out stale pins; the rendering
// side's published filter is still a fallback (defense in depth).

package usecase

import (
	"context"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// WikiSEOUpdater — the narrow port on repo's side (satisfied by corpus.SEORepo).
type WikiSEOUpdater interface {
	UpdateWikiSEO(
		ctx context.Context, ownerID, wikiID, description string, indexed bool,
	) (corpus.Wiki, error)
}

// WikiSEOUpdate — input for one wiki SEO update (excerpt + publish toggle).
type WikiSEOUpdate struct {
	OwnerID     string
	WikiID      string
	Description string
	Published   bool
}

// WikiSEOResult — the updated wiki + the section names it was auto-removed from
// because of unpublish.
type WikiSEOResult struct {
	Unpinned []string
	Wiki     corpus.Wiki
}

// UpdateWikiSEOWithPins — changes excerpt/published, auto-unpinning on unpublish.
// Returns the updated wiki + the section names it was removed from.
func UpdateWikiSEOWithPins(
	ctx context.Context, seo WikiSEOUpdater, pins PagePinDeps, upd WikiSEOUpdate,
) (WikiSEOResult, error) {
	updated, err := seo.UpdateWikiSEO(ctx, upd.OwnerID, upd.WikiID, upd.Description, upd.Published)
	if err != nil {
		return WikiSEOResult{}, fmt.Errorf("update wiki seo: %w", err)
	}
	if upd.Published {
		return WikiSEOResult{Wiki: updated, Unpinned: []string{}}, nil
	}
	unpinned, uerr := UnpinWikiEverywhere(ctx, pins, upd.OwnerID, upd.WikiID)
	if uerr != nil {
		return WikiSEOResult{}, fmt.Errorf("auto-unpin on unpublish: %w", uerr)
	}
	return WikiSEOResult{Wiki: updated, Unpinned: unpinned}, nil
}

// SweepPagePins — cleanup after a batch write path (vault sync): removes pins that are
// deleted/unpublished. Routes each one through the same mutate path, no second
// implementation.
func SweepPagePins(ctx context.Context, pins PagePinDeps, ownerID string) error {
	content, err := loadPageContentOrDefault(ctx, PageDeps{Owners: pins.Owners}, ownerID)
	if err != nil {
		return err
	}
	join, err := LoadPinJoin(ctx, pins, ownerID, &content)
	if err != nil {
		return err
	}
	for _, id := range collectStalePins(&content, join.Cards) {
		if _, uerr := UnpinWikiEverywhere(ctx, pins, ownerID, id); uerr != nil {
			return uerr
		}
	}
	return nil
}

// collectStalePins — the set of pin ids that are no longer published (or the entry was
// deleted, so the join misses).
func collectStalePins(
	content *entity.PageContent, cards map[string]corpus.WikiCard,
) []string {
	stale := []string{}
	for _, id := range append(append([]string{}, content.Insights...), content.Projects...) {
		card, ok := cards[id]
		if !ok || !card.Published {
			stale = append(stale, id)
		}
	}
	return stale
}
