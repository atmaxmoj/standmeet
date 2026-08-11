// corpus_lister_pg_list.go —— pgCorpusLister.List: lazy one-level navigation. Preserves
// old listEntries: an empty parentPath lists the wiki roots PLUS the flat output/writing
// genres; a non-empty parentPath drills the wiki subtree (wiki children only). Each child
// path is computed here; ACL is applied before returning. Output/writing roots load via
// the genre repos (the old in-memory window, now read at list-time).

package usecase

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// corpusRootLimit —— flat output/writing roots cap (mirrors the old retriever window of
// 50; deeper entries are reachable via corpus_search, not the root listing).
const corpusRootLimit = 50

// List —— see file header.
func (l *pgCorpusLister) List(
	ctx context.Context, ownerID string, scope access.CorpusScope, parentPath string, page int,
) ([]Meta, error) {
	wikiRows, err := l.listWikiChildren(ctx, ownerID, scope, parentPath, page)
	if err != nil {
		return nil, err
	}
	if parentPath != "" {
		return wikiRows, nil // drilling a wiki subtree: wiki children only
	}
	out := make([]Meta, 0, len(wikiRows))
	out = append(out, wikiRows...)
	out = append(out, l.listOutputRoots(ctx, ownerID, scope)...)
	out = append(out, l.listWritingRoots(ctx, ownerID, scope)...)
	return out, nil
}

func (l *pgCorpusLister) listWikiChildren(
	ctx context.Context, ownerID string, scope access.CorpusScope, parentPath string, page int,
) ([]Meta, error) {
	var parentID *string
	if parentPath != "" {
		id, rerr := ResolveWikiNodeID(ctx, l.wiki, ownerID, parentPath)
		if rerr != nil {
			return nil, rerr
		}
		parentID = &id
	}
	offset := int32(page) * ListPageLimit
	kids, lerr := l.wiki.ListChildren(ctx, ownerID, parentID, ListPageLimit, offset)
	if lerr != nil {
		return nil, fmt.Errorf("list wiki children: %w", lerr)
	}
	return wikiChildRows(scope, parentPath, kids), nil
}

// wikiChildRows —— children meta → Meta with computed path, ACL-filtered.
func wikiChildRows(
	scope access.CorpusScope, parentPath string, kids []repo.WikiMeta,
) []Meta {
	out := make([]Meta, 0, len(kids))
	for i := range kids {
		childPath := PathSegment(kids[i].Title)
		if parentPath != "" {
			childPath = parentPath + "/" + childPath
		}
		if !allowsCorpusEntry(scope, "wiki", childPath, kids[i].Published) {
			continue
		}
		out = append(out, Meta{
			ID: kids[i].ID, Path: childPath, Title: kids[i].Title,
			Genre: "wiki", ParentID: kids[i].ParentID, HasChildren: kids[i].HasChildren,
		})
	}
	return out
}

func (l *pgCorpusLister) listOutputRoots(
	ctx context.Context, ownerID string, scope access.CorpusScope,
) []Meta {
	outputs, err := l.output.ListByOwner(ctx, ownerID, corpusRootLimit)
	if err != nil {
		return []Meta{}
	}
	paths := OutputTreePaths(outputs)
	out := make([]Meta, 0, len(outputs))
	for i := range outputs {
		p := paths[outputs[i].ID()]
		if !allowsCorpusEntry(scope, "output", p, outputs[i].Published()) {
			continue
		}
		out = append(out, Meta{
			ID: outputs[i].ID(), Path: p, Title: outputs[i].Title(), Genre: "output",
		})
	}
	return out
}

func (l *pgCorpusLister) listWritingRoots(
	ctx context.Context, ownerID string, scope access.CorpusScope,
) []Meta {
	writings, err := l.writing.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return []Meta{}
	}
	out := make([]Meta, 0, len(writings))
	for i := range writings {
		p := writings[i].Path()
		if !allowsCorpusEntry(scope, "writing", p, writings[i].IsPublished()) {
			continue
		}
		out = append(out, Meta{
			ID: writings[i].ID(), Path: p, Title: writings[i].Title(), Genre: "writing",
		})
	}
	return out
}
