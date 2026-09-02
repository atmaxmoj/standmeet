// wiki_tree_context.go — a node's "context": the ancestor chain (breadcrumb) + its
// direct children (SubEntriesRail). Uses the same lazy-loading + cascade scope as the
// tree endpoints: path is resolved to a nodeID by walking the tree, then visibleChain
// checks the whole chain is visible — an ancestor outside scope never appears in the
// breadcrumb (a gated title is never leaked), and child nodes are filtered by scope too.
//
// The landing page's SSR uses this to draw the breadcrumb + sub-rail; the client tree
// sidebar goes through WikiTreeChildren.

package usecase

import (
	"context"
	"errors"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// WikiContext — a node's context. Ancestors is in root->parent order (excludes itself).
type WikiContext struct {
	Ancestors []WikiTreeNode
	Children  []WikiTreeNode
}

// WikiNodeContext — fetches the ancestor chain + direct children for the entry at
// path. If path doesn't exist / is outside scope -> an empty context (no error, and
// the frontend simply draws no breadcrumb/rail).
func WikiNodeContext(
	ctx context.Context, deps SEODeps, path string, scope WikiTreeScope,
) (WikiContext, error) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return emptyWikiContext(), nil
	}
	nodeID, err := corpus.ResolveWikiNodeID(ctx, deps.Wiki, soleOwner.ID, path)
	if err != nil {
		if errors.Is(err, corpus.ErrWikiNotFound) {
			return emptyWikiContext(), nil // path doesn't exist -> empty (no error)
		}
		return WikiContext{}, fmt.Errorf("wiki context resolve: %w", err)
	}
	q := &wikiTreeQuery{repo: deps.Wiki, ownerID: soleOwner.ID, scope: scope}
	return q.context(ctx, nodeID)
}

// context — nodeID's ancestor chain + direct children. If the node (or any ancestor) is
// not visible -> an empty context.
func (q *wikiTreeQuery) context(ctx context.Context, nodeID string) (WikiContext, error) {
	chain, err := q.visibleChain(ctx, nodeID)
	if err != nil {
		return WikiContext{}, fmt.Errorf("wiki context chain: %w", err)
	}
	if len(chain) == 0 {
		return emptyWikiContext(), nil
	}
	self := chain[len(chain)-1]
	children, lerr := q.listChildren(ctx, nodeID, self.Path)
	if lerr != nil {
		return WikiContext{}, fmt.Errorf("wiki context children: %w", lerr)
	}
	return WikiContext{Ancestors: chain[:len(chain)-1], Children: children}, nil
}

func emptyWikiContext() WikiContext {
	return WikiContext{Ancestors: []WikiTreeNode{}, Children: []WikiTreeNode{}}
}
