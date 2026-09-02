// page_pinnable.go — which corpus entries can be pinned to the home page.
//
// The rule is pinned ⊆ published: only published wiki entries can go on the home page.
// This rule used to live inside the panel's candidate-list handler (it filtered published
// and computed tree paths itself), which meant an owner couldn't ask Claude Code "what can
// I pin" — that surface simply had no such thing. The rule now travels with pinning
// itself, not with any one surface.

package usecase

import (
	"context"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// PinnableEntry — one pinnable candidate: id, title, and its location in the reader.
type PinnableEntry struct {
	ID    string
	Title string
	Path  string
}

// ListPinnable — lists the entries that can be pinned to the home page (published wiki).
func ListPinnable(
	ctx context.Context, deps PagePinDeps, ownerID string,
) ([]PinnableEntry, error) {
	metas, err := deps.Wiki.ListAllMeta(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list pinnable: %w", err)
	}
	paths := corpus.WikiMetaTreePaths(metas)
	items := []PinnableEntry{}
	for i := range metas {
		if !metas[i].Published {
			continue // pinned ⊆ published
		}
		items = append(items, PinnableEntry{
			ID: metas[i].ID, Title: metas[i].Title, Path: paths[metas[i].ID],
		})
	}
	return items, nil
}
