// sync_ambiguity.go — "does this title point at exactly one thing?"
//
// reconcile claims by title across genres by default, which is exactly what lets
// move happen IN PLACE (wiki/x.md moving to subjectivity/x.md changes genre on the
// same row, instead of deleting one row and creating another). The cost: once a
// title isn't unique, claiming by title is a lottery — `GetNoteByTitleAnyGenre`
// grabs the oldest match.
//
// The criterion lives in the CORPUS, not in this upload batch (F-L-61). This used
// to only count collisions within the upload tree: when the whole vault is
// uploaded, both same-name files are present and the collision is countable; but
// when the owner uploads just one of them, that title is unique within this batch,
// so claiming by title matches the same-name note sitting in a different genre —
// one never uploaded this time — and UPDATES it into this upload's genre. Cost
// measured in prod: a two-file subset upload turned into `raw 482→479 · wiki
// 575→578`, with the receipt still saying deleted 0. genre is the boundary visitor
// ACL authorizes on, and raw is private material — one partial feed moved three
// private notes to the published side.
//
// Collisions within the upload tree still must be counted: when two new same-name
// files arrive in the same batch, the corpus doesn't have either of them yet (F-L-2).

package obsidian

import (
	"context"
	"fmt"
	"strings"
)

// ambiguousTitles — the set of titles (lowercased) that "can't be claimed by title"
// for this reconcile. Titles already duplicated in the corpus ∪ titles colliding
// within this upload batch.
func ambiguousTitles(
	ctx context.Context, deps *SyncDeps, ownerID string, tree []*desiredNode,
) (map[string]bool, error) {
	dup := collidingTitles(tree)
	existing, err := deps.Notes.DuplicateTitles(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("corpus duplicate titles: %w", err)
	}
	for _, t := range existing {
		dup[strings.ToLower(t)] = true
	}
	return dup, nil
}

// collidingTitles —— titles shared by more than one node in THIS upload.
func collidingTitles(tree []*desiredNode) map[string]bool {
	seen := map[string]int{}
	for _, n := range tree {
		seen[strings.ToLower(n.title)]++
	}
	dup := map[string]bool{}
	for title, count := range seen {
		if count > 1 {
			dup[title] = true
		}
	}
	return dup
}
