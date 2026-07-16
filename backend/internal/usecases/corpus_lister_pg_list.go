// corpus_lister_pg_list.go —— pgCorpusLister.List: lazy one-level navigation. Preserves
// old listEntries: an empty parentPath lists the wiki roots PLUS the flat output/writing
// genres; a non-empty parentPath drills the wiki subtree (wiki children only). Each child
// path is computed here; ACL is applied before returning. Output/writing roots load via
// the genre repos (the old in-memory window, now read at list-time).

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// corpusRootLimit —— flat output/writing roots cap (mirrors the old retriever window of
// 50; deeper entries are reachable via corpus_search, not the root listing).
const corpusRootLimit = 50

// List —— see file header.
func (l *pgCorpusLister) List(
	ctx context.Context, ownerID string, grantedGlobs []string, parentPath string, page int,
) ([]CorpusMeta, error) {
	wikiRows, err := l.listWikiChildren(ctx, ownerID, grantedGlobs, parentPath, page)
	if err != nil {
		return nil, err
	}
	if parentPath != "" {
		return wikiRows, nil // drilling a wiki subtree: wiki children only
	}
	out := make([]CorpusMeta, 0, len(wikiRows))
	out = append(out, wikiRows...)
	out = append(out, l.listOutputRoots(ctx, ownerID, grantedGlobs)...)
	out = append(out, l.listWritingRoots(ctx, ownerID, grantedGlobs)...)
	return out, nil
}

func (l *pgCorpusLister) listWikiChildren(
	ctx context.Context, ownerID string, globs []string, parentPath string, page int,
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
	return wikiChildRows(globs, parentPath, kids), nil
}

// wikiChildRows —— children meta → CorpusMeta with computed path, ACL-filtered.
func wikiChildRows(
	globs []string, parentPath string, kids []postgres.WikiMeta,
) []CorpusMeta {
	out := make([]CorpusMeta, 0, len(kids))
	for i := range kids {
		childPath := pathSegment(kids[i].Title)
		if parentPath != "" {
			childPath = parentPath + "/" + childPath
		}
		acl := noteACL{genre: "wiki", path: childPath, ownerOnly: kids[i].OwnerOnly}
		if !allowsNote(globs, acl) {
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
	ctx context.Context, ownerID string, globs []string,
) []CorpusMeta {
	outputs, err := l.output.ListByOwner(ctx, ownerID, corpusRootLimit)
	if err != nil {
		return []CorpusMeta{}
	}
	paths := OutputTreePaths(outputs)
	out := make([]CorpusMeta, 0, len(outputs))
	for i := range outputs {
		p := paths[outputs[i].ID()]
		if !allowsNote(
			globs,
			noteACL{genre: "output", path: p},
		) { // domain.Output has no owner tier yet (D.2)
			continue
		}
		out = append(out, CorpusMeta{
			ID: outputs[i].ID(), Path: p, Title: outputs[i].Title(), Genre: "output",
		})
	}
	return out
}

func (l *pgCorpusLister) listWritingRoots(
	ctx context.Context, ownerID string, globs []string,
) []CorpusMeta {
	writings, err := l.writing.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(writings))
	for i := range writings {
		p := writings[i].Path()
		// writings have no owner tier (D.2: they exist to be published).
		if !allowsNote(globs, noteACL{genre: "writing", path: p}) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: writings[i].ID(), Path: p, Title: writings[i].Title(), Genre: "writing",
		})
	}
	return out
}
