// wiki_tree.go — **true lazy-loading** layered pagination + ACL filtering for the
// public wiki tree. Shared by both the wiki landing sidebar (#37) and the
// reader/writing entry point (#43).
//
// The lazy loading is per-layer: one query fetches one layer at a time (roots / a
// node's direct children, via ListChildren on the DB side, meta-only), **the whole tree
// is never loaded**. A large corpus no longer hits the newest-50 cap.
//
// Visibility goes through scope: anonymous sees published only; with a code, admission
// follows the role's corpus_uris glob. Filesystem-style cascade: an entry is visible ⟺
// it passes the gate itself **and** every ancestor passes the gate too — a gated
// ancestor makes its whole subtree invisible (a gated title is never leaked, and an
// indexed child never gets promoted to the root). Under lazy loading, cascade is
// enforced like this: before listing a parent's children, walk parent->root to verify
// the whole chain is visible (visibleChain); a broken chain -> return an empty layer;
// an intact chain -> the parent is already visible, so a child's visibility depends only
// on whether the child itself passes the gate.
//
// path follows the same convention as GetWikiLanding (tree-derived, built by chaining
// corpus.PathSegment(title)), and the frontend appends path directly onto /wiki/<path>.

package usecase

import (
	"context"
	"fmt"
	"slices"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// wikiTreeLayerCap — the maximum number of nodes returned in one layer. Under
// per-layer lazy loading this caps **one layer** (not the whole corpus), far looser
// than the old newest-50 whole-tree cap. The frontend tree isn't paginated yet, so a
// generous value is used.
const wikiTreeLayerCap = 500

// WikiTreeNode — one node of the tree (a single layer). HasChildren decides whether
// the frontend draws an expand arrow.
type WikiTreeNode struct {
	ID          string
	Title       string
	Path        string
	HasChildren bool
}

// WikiTreeScope — decides whether one wiki entry (by published + tree-derived path)
// passes the gate for the current viewer. Looks only at the node **itself**; the
// cascade's ancestor chain is checked separately by visibleChain.
type WikiTreeScope func(seoIndexed bool, path string) bool

// PublicWikiScope — anonymous: only published is visible (consistent with GetWikiLanding).
func PublicWikiScope(seoIndexed bool, _ string) bool {
	return seoIndexed
}

// RoleWikiScope — with a code: the role's admission decides on wiki://<path>.
//
// `seoIndexed` is this entry's own published flag — it used to be discarded here
// (`_`) — and it's exactly the sole criterion for the public identity. It's now passed
// through: an invited identity still goes through the role's glob, while the public
// identity looks at the entry itself (F-D-7).
func RoleWikiScope(snap *access.RoleSnapshot) WikiTreeScope {
	return func(seoIndexed bool, path string) bool {
		return snap.AllowsCorpus("wiki://"+path, seoIndexed)
	}
}

// WikiTreeScopeFor — bearer token -> scope. An empty / invalid token, or no store,
// all fall back to anonymous (published only); a valid session -> the role's
// corpus_uris scope.
func WikiTreeScopeFor(
	ctx context.Context, sessions *access.VisitorSessionStore, token string,
) WikiTreeScope {
	snap := sessionRoleSnapshot(ctx, sessions, token)
	if snap == nil {
		return PublicWikiScope
	}
	return RoleWikiScope(snap)
}

// sessionRoleSnapshot — exchanges a token for a RoleSnapshot; any missing data/error ->
// nil (falls back to anonymous).
func sessionRoleSnapshot(
	ctx context.Context, sessions *access.VisitorSessionStore, token string,
) *access.RoleSnapshot {
	if token == "" || sessions == nil {
		return nil
	}
	data, err := sessions.Get(ctx, token)
	if err != nil {
		return nil
	}
	return data.RoleSnapshot
}

// wikiTreeQuery — the shared context for one tree query (repo + owner + scope);
// gathers the shared params beyond ctx into the receiver to respect argument-limit.
type wikiTreeQuery struct {
	repo    corpus.WikiLister
	scope   WikiTreeScope
	ownerID string
}

// WikiTreeStats — the sidebar footer counts. Entries / Roots are facts about this
// corpus (how many entries total, how many roots); **Gated is relative to this
// visitor**: how many are closed off to him.
//
// The previous version was a single `COUNT(*) WHERE NOT published`, which never looked
// at the session at all. So a visitor invited via a role granting `wiki://**` would be
// told "222 GATED" while being able to open any of them with a click — within the same
// session, the sidebar tree, the entry page, and search all honored that grant, and only
// this count (and the /wiki index) went by the published flag. One question, two gates,
// and this used the wrong one (F-L-14).
//
// It now counts by scope, with the cascade matching the tree: an entry is visible ⟺ it
// passes the gate itself and every ancestor passes the gate too. One ListAllMeta call
// (no body) + assembling paths in memory; at the scale of a personal corpus, this
// matters far more than saving one COUNT query.
func WikiTreeStats(
	ctx context.Context, deps SEODeps, scope WikiTreeScope,
) (corpus.WikiStats, error) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return corpus.WikiStats{}, nil
	}
	metas, err := deps.Wiki.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return corpus.WikiStats{}, fmt.Errorf("wiki tree stats: %w", err)
	}
	return countVisible(metas, scope), nil
}

// countVisible — entries / roots are counted as-is; gated = the count this visitor
// can't see.
func countVisible(metas []corpus.WikiMeta, scope WikiTreeScope) corpus.WikiStats {
	byID := make(map[string]*corpus.WikiMeta, len(metas))
	for i := range metas {
		byID[metas[i].ID] = &metas[i]
	}
	stats := corpus.WikiStats{Entries: len(metas)}
	for i := range metas {
		if metas[i].ParentID == nil {
			stats.Roots++
		}
		if !visibleWithAncestors(byID, &metas[i], scope) {
			stats.Gated++
		}
	}
	return stats
}

// visibleWithAncestors — every level from root down to itself must pass the gate (the
// same rule as visibleChain). path is PathSegment chained together, the same
// convention used by the tree and the entry page.
func visibleWithAncestors(
	byID map[string]*corpus.WikiMeta, node *corpus.WikiMeta, scope WikiTreeScope,
) bool {
	chain := ancestorChain(byID, node)
	segs := make([]string, 0, len(chain))
	for _, meta := range slices.Backward(chain) {
		segs = append(segs, corpus.PathSegment(meta.Title))
		if !scope(meta.Published, strings.Join(segs, "/")) {
			return false
		}
	}
	return true
}

// ancestorChain — node -> root (itself comes first). If a parent isn't found in the
// graph (shouldn't happen in theory), the chain simply stops there.
func ancestorChain(
	byID map[string]*corpus.WikiMeta, node *corpus.WikiMeta,
) []*corpus.WikiMeta {
	out := make([]*corpus.WikiMeta, 0, corpus.TreeMaxDepth)
	cur := node
	for range corpus.TreeMaxDepth {
		out = append(out, cur)
		if cur.ParentID == nil {
			break
		}
		parent, ok := byID[*cur.ParentID]
		if !ok {
			break
		}
		cur = parent
	}
	return out
}

// WikiTreeChildren — returns parentID's directly visible children (parentID="" -> roots).
// For a non-root, first verifies the whole parent chain is visible (cascade); a broken
// chain -> an empty layer.
func WikiTreeChildren(
	ctx context.Context, deps SEODeps, parentID string, scope WikiTreeScope,
) ([]WikiTreeNode, error) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []WikiTreeNode{}, nil
	}
	q := &wikiTreeQuery{repo: deps.Wiki, ownerID: soleOwner.ID, scope: scope}
	parentPath := ""
	if parentID != "" {
		chain, err := q.visibleChain(ctx, parentID)
		if err != nil {
			return nil, fmt.Errorf("wiki tree parent: %w", err)
		}
		if len(chain) == 0 {
			return []WikiTreeNode{}, nil // a gated ancestor chain -> the whole subtree is invisible
		}
		parentPath = chain[len(chain)-1].Path
	}
	return q.listChildren(ctx, parentID, parentPath)
}

// visibleChain — walks the chain from nodeID->root, computing each node's path
// top-down + checking scope. If the whole chain passes -> returns the visible chain of
// nodes from root->node (inclusive); if any ancestor (or itself) fails the gate ->
// returns an empty slice.
func (q *wikiTreeQuery) visibleChain(
	ctx context.Context, nodeID string,
) ([]WikiTreeNode, error) {
	metas, err := q.walkToRoot(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	nodes := make([]WikiTreeNode, 0, len(metas))
	segs := make([]string, 0, len(metas))
	for _, meta := range slices.Backward(metas) {
		segs = append(segs, corpus.PathSegment(meta.Title))
		path := strings.Join(segs, "/")
		if !q.scope(meta.Published, path) {
			return []WikiTreeNode{}, nil
		}
		nodes = append(nodes, WikiTreeNode{ID: meta.ID, Title: meta.Title, Path: path})
	}
	return nodes, nil
}

// walkToRoot — walks up via parent_id collecting meta (bottom-up, no body read), up
// to root or maxDepth.
func (q *wikiTreeQuery) walkToRoot(
	ctx context.Context, nodeID string,
) ([]corpus.WikiMeta, error) {
	out := make([]corpus.WikiMeta, 0, corpus.TreeMaxDepth)
	cur := nodeID
	for range corpus.TreeMaxDepth {
		meta, err := q.repo.GetMetaByID(ctx, q.ownerID, cur)
		if err != nil {
			return nil, fmt.Errorf("wiki meta walk: %w", err)
		}
		out = append(out, meta)
		if meta.ParentID == nil {
			break
		}
		cur = *meta.ParentID
	}
	return out, nil
}

// listChildren — the DB lists parentID's direct children, and each is individually
// checked against its own gate (the parent was already verified visible).
// has_children means "has >= 1 visible child": computed by peeking one layer down;
// no visible child -> no arrow drawn.
func (q *wikiTreeQuery) listChildren(
	ctx context.Context, parentID, parentPath string,
) ([]WikiTreeNode, error) {
	kids, err := q.repo.ListChildren(ctx, q.ownerID, parentPtr(parentID), wikiTreeLayerCap, 0)
	if err != nil {
		return nil, fmt.Errorf("list wiki children: %w", err)
	}
	out := make([]WikiTreeNode, 0, len(kids))
	for i := range kids {
		path := joinSeg(parentPath, corpus.PathSegment(kids[i].Title))
		if !q.scope(kids[i].Published, path) {
			continue
		}
		hasKids, herr := q.hasVisibleChild(ctx, kids[i].ID, path)
		if herr != nil {
			return nil, herr
		}
		out = append(out, WikiTreeNode{
			ID: kids[i].ID, Title: kids[i].Title, Path: path, HasChildren: hasKids,
		})
	}
	return out, nil
}

// hasVisibleChild — whether nodeID has >= 1 direct child that passes the gate
// (nodePath is already known to be visible).
func (q *wikiTreeQuery) hasVisibleChild(
	ctx context.Context, nodeID, nodePath string,
) (bool, error) {
	kids, err := q.repo.ListChildren(ctx, q.ownerID, &nodeID, wikiTreeLayerCap, 0)
	if err != nil {
		return false, fmt.Errorf("peek wiki children: %w", err)
	}
	for i := range kids {
		if q.scope(kids[i].Published, joinSeg(nodePath, corpus.PathSegment(kids[i].Title))) {
			return true, nil
		}
	}
	return false, nil
}

// parentPtr — "" (roots) -> nil, otherwise &id; fed into ListChildren's parentID param.
func parentPtr(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

func joinSeg(base, seg string) string {
	if base == "" {
		return seg
	}
	return base + "/" + seg
}
