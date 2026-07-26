// corpus_lister_pg_list.go —— pgCorpusLister.List: lazy one-level navigation. Preserves
// old listEntries: an empty parentPath lists the wiki roots PLUS the flat output/writing
// genres; a non-empty parentPath drills the wiki subtree (wiki children only). Each child
// path is computed here; ACL is applied before returning. Output/writing roots load via
// the genre repos (the old in-memory window, now read at list-time).

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/corpus"
)

// corpusRootLimit —— flat output/writing roots cap (mirrors the old retriever window of
// 50; deeper entries are reachable via corpus_search, not the root listing).
const corpusRootLimit = 50

// List —— see file header.
func (l *pgCorpusLister) List(
	ctx context.Context, ownerID string, scope access.CorpusScope, parentPath string, page int,
) ([]CorpusMeta, error) {
	wikiRows, err := l.listWikiChildren(ctx, ownerID, scope, parentPath, page)
	if err != nil {
		return nil, err
	}
	if parentPath != "" {
		return wikiRows, nil // drilling a wiki subtree: wiki children only
	}
	out := make([]CorpusMeta, 0, len(wikiRows))
	out = append(out, wikiRows...)
	out = append(out, l.listOutputRoots(ctx, ownerID, scope)...)
	out = append(out, l.listWritingRoots(ctx, ownerID, scope)...)
	return out, nil
}

func (l *pgCorpusLister) listWikiChildren(
	ctx context.Context, ownerID string, scope access.CorpusScope, parentPath string, page int,
) ([]CorpusMeta, error) {
	var parentID *string
	if parentPath != "" {
		id, rerr := resolveWikiNodeID(ctx, l.wiki, ownerID, parentPath)
		if rerr != nil {
			return nil, rerr
		}
		parentID = &id
	}
	offset := int32(page) * listPageLimit
	kids, lerr := l.wiki.ListChildren(ctx, ownerID, parentID, listPageLimit, offset)
	if lerr != nil {
		return nil, fmt.Errorf("list wiki children: %w", lerr)
	}
	return wikiChildRows(scope, parentPath, kids), nil
}

// wikiChildRows —— children meta → CorpusMeta with computed path, ACL-filtered.
func wikiChildRows(
	scope access.CorpusScope, parentPath string, kids []corpus.WikiMeta,
) []CorpusMeta {
	out := make([]CorpusMeta, 0, len(kids))
	for i := range kids {
		childPath := pathSegment(kids[i].Title)
		if parentPath != "" {
			childPath = parentPath + "/" + childPath
		}
		if !allowsCorpusURI(scope, "wiki", childPath) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: kids[i].ID, Path: childPath, Title: kids[i].Title,
			Genre: "wiki", ParentID: kids[i].ParentID, HasChildren: kids[i].HasChildren,
		})
	}
	return out
}

func (l *pgCorpusLister) listOutputRoots(
	ctx context.Context, ownerID string, scope access.CorpusScope,
) []CorpusMeta {
	outputs, err := l.output.ListByOwner(ctx, ownerID, corpusRootLimit)
	if err != nil {
		return []CorpusMeta{}
	}
	paths := OutputTreePaths(outputs)
	out := make([]CorpusMeta, 0, len(outputs))
	for i := range outputs {
		p := paths[outputs[i].ID()]
		if !allowsCorpusURI(scope, "output", p) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: outputs[i].ID(), Path: p, Title: outputs[i].Title(), Genre: "output",
		})
	}
	return out
}

func (l *pgCorpusLister) listWritingRoots(
	ctx context.Context, ownerID string, scope access.CorpusScope,
) []CorpusMeta {
	writings, err := l.writing.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(writings))
	for i := range writings {
		p := writings[i].Path()
		if !allowsCorpusURI(scope, "writing", p) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: writings[i].ID(), Path: p, Title: writings[i].Title(), Genre: "writing",
		})
	}
	return out
}
