// page_cards.go — the keyless "published corpus cards" list.
//
// A custom page (the redesigned homepage among them) renders corpus entries as cards without
// hand-picking IDs: this returns every PUBLISHED wiki entry as {title, excerpt, path}, in tree
// order. It only ever returns published entries, so "never surface an unpublished note" holds
// by construction — which is what lets the old pinned-cards machinery and its unpublish cascade
// be retired: a page lists these and links to the reader, rather than maintaining a pin set.

package usecase

import (
	"context"
	"fmt"
	"slices"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// CorpusCard — one published entry as a home-page card: what to show (title + excerpt) and
// where it links (the reader path under /wiki/). Its own type, not the pin card, so it outlives
// the pin system's removal.
type CorpusCard struct {
	Title   string
	Excerpt string
	Path    string
}

// ListPublishedCards — published wiki entries as cards, in tree-path order, for the sole owner.
// Reuses the same excerpt derivation as pins (cardLine) minus the curation.
func ListPublishedCards(ctx context.Context, deps SEODeps) ([]CorpusCard, error) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []CorpusCard{}, nil // pre-claim: no owner, nothing published yet
	}
	metas, err := deps.Wiki.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return nil, fmt.Errorf("list wiki meta: %w", err)
	}
	paths := corpus.WikiMetaTreePaths(metas)
	ids := publishedIDsByPath(metas, paths)
	cards, err := deps.Wiki.ListCardsByIDs(ctx, soleOwner.ID, ids)
	if err != nil {
		return nil, fmt.Errorf("list wiki cards: %w", err)
	}
	return assembleCards(ids, cards, paths), nil
}

// assembleCards — join ids (already published + path-ordered) to their card content, skipping
// any that fell out of the card fetch or lost their published flag between the two reads.
func assembleCards(
	ids []string, cards map[string]corpus.WikiCard, paths map[string]string,
) []CorpusCard {
	out := make([]CorpusCard, 0, len(ids))
	for _, id := range ids {
		c, present := cards[id]
		if !present || !c.Published {
			continue
		}
		out = append(out, CorpusCard{Title: c.Title, Excerpt: cardLine(&c), Path: paths[id]})
	}
	return out
}

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

// publishedIDsByPath — published wiki ids ordered by their reader path, so the card list is
// stable and hierarchical rather than in arbitrary storage order.
func publishedIDsByPath(metas []corpus.WikiMeta, paths map[string]string) []string {
	ids := make([]string, 0, len(metas))
	for i := range metas {
		if metas[i].Published {
			ids = append(ids, metas[i].ID)
		}
	}
	slices.SortStableFunc(ids, func(a, b string) int { return strings.Compare(paths[a], paths[b]) })
	return ids
}
