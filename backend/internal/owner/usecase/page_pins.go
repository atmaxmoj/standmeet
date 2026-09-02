// page_pins.go — the **single** maintenance point for the home page pin lists
// (insights/projects = a window over the corpus) (docs/design/page-corpus-pinning.md).
//
// The invariant pinned ⊆ published is maintained on both write sides, and everything
// routes through here:
//   • PinToPage / ValidatePagePins — pin (MCP page.pin / admin PUT) rejects unpublished
//   • UnpinWikiEverywhere — the unpublish / delete hook: auto-removes + returns the
//     section names it was removed from (the caller declares this side effect in the
//     tool result)
// The rendering side's ResolvePinCards only does a published fallback filter (defense
// in depth, not the primary mechanism).

package usecase

import (
	"context"
	"fmt"
	"slices"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PagePinDeps — dependencies for the pin maintenance point: page_content storage +
// wiki card content/tree paths.
type PagePinDeps struct {
	Owners *repo.Repo
	Wiki   *corpus.WikiRepo
}

// PinSectionInsights / PinSectionProjects — the two pinnable sections.
const (
	PinSectionInsights = "insights"
	PinSectionProjects = "projects"
)

// PinToPage — pins a published wiki entry into a section (idempotent if already pinned).
// Returns that section's up-to-date pin list. Unpublished -> ErrPinUnpublished;
// nonexistent -> ErrPinNotFound; invalid section name -> error.
func PinToPage(
	ctx context.Context, deps PagePinDeps, ownerID, section, wikiID string,
) ([]string, error) {
	if err := checkPinnable(ctx, deps, ownerID, wikiID); err != nil {
		return nil, err
	}
	return mutatePins(ctx, deps, ownerID, section, func(pins []string) []string {
		return appendPinOnce(pins, wikiID)
	})
}

// UnpinFromPage — removes a pin from a section (idempotent if not in the list).
// Returns the up-to-date list.
func UnpinFromPage(
	ctx context.Context, deps PagePinDeps, ownerID, section, wikiID string,
) ([]string, error) {
	return mutatePins(ctx, deps, ownerID, section, func(pins []string) []string {
		return removePin(pins, wikiID)
	})
}

// UnpinWikiEverywhere — the unpublish / delete hook: removes this entry from every
// section, returns the section names it was removed from (empty = it wasn't pinned to
// begin with). The caller writes this into the tool result to declare the side effect.
func UnpinWikiEverywhere(
	ctx context.Context, deps PagePinDeps, ownerID, wikiID string,
) ([]string, error) {
	content, err := loadPageContentOrDefault(ctx, PageDeps{Owners: deps.Owners}, ownerID)
	if err != nil {
		return nil, err
	}
	touched := collectTouchedSections(&content, wikiID)
	if len(touched) == 0 {
		return []string{}, nil
	}
	content.Insights = removePin(content.Insights, wikiID)
	content.Projects = removePin(content.Projects, wikiID)
	if _, uerr := deps.Owners.UpsertPageContent(ctx, ownerID, &content); uerr != nil {
		return nil, fmt.Errorf("auto-unpin save: %w", uerr)
	}
	return touched, nil
}

// ValidatePagePins — validated before an admin PUT saves the whole section: every pin
// must exist and be published. Shares checkPinnable with PinToPage — a single
// maintenance point, not a second implementation.
func ValidatePagePins(
	ctx context.Context, deps PagePinDeps, ownerID string, content *entity.PageContent,
) error {
	for _, id := range append(append([]string{}, content.Insights...), content.Projects...) {
		if err := checkPinnable(ctx, deps, ownerID, id); err != nil {
			return err
		}
	}
	return nil
}

// ResolvePinCards — pin list -> rendered cards (title + excerpt + tree-derived path), in
// pin order; a deleted/unpublished (fallback) entry is skipped. paths is passed in by the
// caller (one ListAllMeta call serves both sections).
func ResolvePinCards(
	cards map[string]corpus.WikiCard, paths map[string]string, pins []string,
) []entity.PagePinCard {
	out := make([]entity.PagePinCard, 0, len(pins))
	for _, id := range pins {
		card, ok := cards[id]
		if !ok || !card.Published {
			continue
		}
		out = append(out, entity.PagePinCard{
			WikiID: id, Title: card.Title, Excerpt: cardLine(&card), Path: paths[id],
		})
	}
	return out
}

// cardLineMax — the cap on the line shown on a card. A bit longer than a search-result
// line: this is the home page, and readers linger here longer.
const cardLineMax = 180

// cardLine — the line shown under a card's title. **If the owner wrote one, use his**;
// if not, derive the leading sentence from the body (F-L-47).
//
// Why not "leave it empty if unwritten": syncing the real vault produces no excerpt
// (1047 entries, 0 non-empty), so the home-page section would be left with nothing but
// two lines of slugs — and this section is exactly "what am I thinking about". A rule
// that says "must remember to fill this in by hand" eventually meets the one time nobody
// remembers; anything derivable from the data shouldn't require manual entry. The owner's
// own version still takes priority: if he wrote one, it always wins.
//
// If nothing can be derived (the whole note is pure structure), return an empty string —
// a card with just a title is better than exposing raw markup like `> [!i18n] <label...`
// ([[display-fallback-reintroduces-the-bug]]: a fallback must never surface raw markup).
func cardLine(card *corpus.WikiCard) string {
	if strings.TrimSpace(card.Excerpt) != "" {
		return card.Excerpt
	}
	return corpus.LeadLine(card.Body, cardLineMax)
}

// PinJoin — the one-shot join result for both sections' pins: card content + full
// tree paths.
type PinJoin struct {
	Cards map[string]corpus.WikiCard
	Paths map[string]string
}

// LoadPinJoin — a one-shot join for both sections' pins: card content + full tree paths.
func LoadPinJoin(
	ctx context.Context, deps PagePinDeps, ownerID string, content *entity.PageContent,
) (PinJoin, error) {
	ids := append(append([]string{}, content.Insights...), content.Projects...)
	if len(ids) == 0 {
		return PinJoin{Cards: map[string]corpus.WikiCard{}, Paths: map[string]string{}}, nil
	}
	cards, err := deps.Wiki.ListCardsByIDs(ctx, ownerID, ids)
	if err != nil {
		return PinJoin{}, fmt.Errorf("pin cards: %w", err)
	}
	metas, err := deps.Wiki.ListAllMeta(ctx, ownerID)
	if err != nil {
		return PinJoin{}, fmt.Errorf("pin paths: %w", err)
	}
	return PinJoin{Cards: cards, Paths: corpus.WikiMetaTreePaths(metas)}, nil
}

func checkPinnable(ctx context.Context, deps PagePinDeps, ownerID, wikiID string) error {
	cards, err := deps.Wiki.ListCardsByIDs(ctx, ownerID, []string{wikiID})
	if err != nil {
		return entity.ErrPinNotFound
	}
	card, ok := cards[wikiID]
	if !ok {
		return entity.ErrPinNotFound
	}
	if !card.Published {
		return entity.ErrPinUnpublished
	}
	return nil
}

func mutatePins(
	ctx context.Context, deps PagePinDeps, ownerID, section string,
	mutate func([]string) []string,
) ([]string, error) {
	content, err := loadPageContentOrDefault(ctx, PageDeps{Owners: deps.Owners}, ownerID)
	if err != nil {
		return nil, err
	}
	if aerr := applySectionMutation(&content, section, mutate); aerr != nil {
		return nil, aerr
	}
	saved, err := deps.Owners.UpsertPageContent(ctx, ownerID, &content)
	if err != nil {
		return nil, fmt.Errorf("save pins: %w", err)
	}
	return sectionPins(&saved, section), nil
}

func applySectionMutation(
	content *entity.PageContent, section string, mutate func([]string) []string,
) error {
	switch section {
	case PinSectionInsights:
		content.Insights = mutate(content.Insights)
	case PinSectionProjects:
		content.Projects = mutate(content.Projects)
	default:
		return fmt.Errorf("unknown pin section %q (insights|projects)", section)
	}
	return nil
}

func sectionPins(content *entity.PageContent, section string) []string {
	if section == PinSectionProjects {
		return content.Projects
	}
	return content.Insights
}

func appendPinOnce(pins []string, wikiID string) []string {
	if slices.Contains(pins, wikiID) {
		return pins
	}
	return append(pins, wikiID)
}

func removePin(pins []string, wikiID string) []string {
	out := make([]string, 0, len(pins))
	for _, p := range pins {
		if p != wikiID {
			out = append(out, p)
		}
	}
	return out
}

func collectTouchedSections(content *entity.PageContent, wikiID string) []string {
	touched := []string{}
	if slices.Contains(content.Insights, wikiID) {
		touched = append(touched, PinSectionInsights)
	}
	if slices.Contains(content.Projects, wikiID) {
		touched = append(touched, PinSectionProjects)
	}
	return touched
}
