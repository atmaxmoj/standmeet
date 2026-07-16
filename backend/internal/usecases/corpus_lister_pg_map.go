// corpus_lister_pg_map.go —— pgCorpusLister.MapEntries + Resolve.
//
// MapEntries loads the whole wiki tree once (the structured genre; derived paths) and returns
// every visible node as {path,title}; the skeleton shaping is pure (BuildCorpusMap). The input
// can be large but the map's OUTPUT is near-constant — that's the whole point.
//
// Resolve turns a bare name (a [[wikilink]] target / title / slug) into the matching node(s),
// so the agent stops guessing a path from a search snippet ("the path errored — let me find
// it" — an observed wasted round).

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// mapEnumerateLimit —— upper bound on wiki nodes loaded for the map/resolve. High enough to be
// "the whole tree" for any real vault; the skeleton collapses it to a constant-size output.
const mapEnumerateLimit = 20000

// visibleWikiNodes —— every wiki node the role may see, as (path, title). Shared by
// MapEntries and Resolve; the full tree in one load, ACL-filtered.
func (l *pgCorpusLister) visibleWikiNodes(
	ctx context.Context, ownerID string, scope domain.CorpusScope,
) ([]CorpusMapEntry, error) {
	wikis, err := l.wiki.ListByOwner(ctx, ownerID, mapEnumerateLimit)
	if err != nil {
		return nil, fmt.Errorf("map enumerate wiki: %w", err)
	}
	paths := WikiTreePaths(wikis)
	out := make([]CorpusMapEntry, 0, len(wikis))
	for i := range wikis {
		p := paths[wikis[i].ID()]
		if p == "" || !allowsCorpusURI(scope, "wiki", p) {
			continue
		}
		out = append(out, CorpusMapEntry{Path: p, Title: wikis[i].Title()})
	}
	return out, nil
}

// MapEntries —— see interface. Enumerate only; shaping is BuildCorpusMap (pure).
func (l *pgCorpusLister) MapEntries(
	ctx context.Context, ownerID string, scope domain.CorpusScope,
) ([]CorpusMapEntry, error) {
	return l.visibleWikiNodes(ctx, ownerID, scope)
}

// Resolve —— name → matching wiki node(s) by exact slug (path last segment) or title-slug.
// Exact matches first (a [[link]] target is a name, not a query); empty result is a clean
// "no such name" the agent can fall back to corpus_search on.
func (l *pgCorpusLister) Resolve(
	ctx context.Context, ownerID string, scope domain.CorpusScope, name string,
) ([]CorpusMeta, error) {
	nodes, err := l.visibleWikiNodes(ctx, ownerID, scope)
	if err != nil {
		return nil, err
	}
	return ResolveByName(nodes, name), nil
}

// ResolveByName —— pure: match a bare name against a node set by slug. Both the path's last
// segment and the title-slug are candidates (the two forms a [[wikilink]] target can take).
func ResolveByName(nodes []CorpusMapEntry, name string) []CorpusMeta {
	want := SlugifyTitle(name)
	if want == "" {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, 2)
	for i := range nodes {
		if lastPathSegment(nodes[i].Path) == want || SlugifyTitle(nodes[i].Title) == want {
			out = append(out, CorpusMeta{Path: nodes[i].Path, Title: nodes[i].Title, Genre: "wiki"})
		}
	}
	return out
}

// lastPathSegment —— the slug after the final "/".
func lastPathSegment(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}
