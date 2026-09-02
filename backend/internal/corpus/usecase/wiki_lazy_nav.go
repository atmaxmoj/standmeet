// wiki_lazy_nav.go — usecase utilities for wiki lazy-load navigation: instead
// of loading the whole tree, walk the parent chain by id (meta-only,
// GetMetaByID) to compute an entry's tree-derived path + check ACL. The
// retriever's DB search/read, and the path in a cited back-lookup, both go
// through this; uses the same slug scheme as WikiTreePaths.

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// resolveChildPageLimit — page size when paging through children at each level
// while descending a path (only needs to be big enough to locate one segment).
const resolveChildPageLimit = 200

// WikiPathByID — walks up parent_id to compute a wiki entry's tree-derived
// path (meta-only, doesn't read body). Uses the same slug scheme as
// WikiTreePaths; lazy-load skips same-name-sibling dedup (rare, edge case
// left unhandled).
func WikiPathByID(
	ctx context.Context, repo WikiLister, ownerID, id string,
) (string, error) {
	segs := make([]string, 0, TreeMaxDepth)
	cur := id
	for range TreeMaxDepth {
		meta, err := repo.GetMetaByID(ctx, ownerID, cur)
		if err != nil {
			return "", fmt.Errorf("wiki meta walk: %w", err)
		}
		segs = append([]string{PathSegment(meta.Title)}, segs...)
		if meta.ParentID == nil {
			break
		}
		cur = *meta.ParentID
	}
	return strings.Join(segs, "/"), nil
}

// OutputPathByID — the output twin of WikiPathByID: walks up parent_id to
// compute an output entry's tree-derived path (meta-only, doesn't read body).
func OutputPathByID(
	ctx context.Context, repo OutputLister, ownerID, id string,
) (string, error) {
	segs := make([]string, 0, TreeMaxDepth)
	cur := id
	for range TreeMaxDepth {
		meta, err := repo.GetMetaByID(ctx, ownerID, cur)
		if err != nil {
			return "", fmt.Errorf("output meta walk: %w", err)
		}
		segs = append([]string{PathSegment(meta.Title)}, segs...)
		if meta.ParentID == nil {
			break
		}
		cur = *meta.ParentID
	}
	return strings.Join(segs, "/"), nil
}

// WikiEntryPath — exported: a wiki entry's tree-derived path (meta-only
// walk-up). corpus write tools (promote_to_wiki / update_wiki) return it in
// their response, so the caller gets the "where it landed" address
// (= corpus_read's input) without having to reverse-derive it from the title
// slug itself.
func WikiEntryPath(
	ctx context.Context, repo WikiLister, ownerID, id string,
) (string, error) {
	return WikiPathByID(ctx, repo, ownerID, id)
}

// OutputEntryPath — the output twin of WikiEntryPath (used by
// promote_wiki_to_output / update_output).
func OutputEntryPath(
	ctx context.Context, repo OutputLister, ownerID, id string,
) (string, error) {
	return OutputPathByID(ctx, repo, ownerID, id)
}

// ResolveWikiNodeID — resolves a **non-empty** tree-derived path down to its
// node id, level by level from root (doesn't load the whole tree: each level
// calls ListChildren meta-only, matching a segment by PathSegment(title)). Any
// segment with no match → ErrWikiNotFound. The root level (empty path) is
// handled by the caller passing a nil parentID directly, and never reaches here.
func ResolveWikiNodeID(
	ctx context.Context, repo WikiLister, ownerID, path string,
) (string, error) {
	var parentID *string
	id := ""
	for seg := range strings.SplitSeq(path, "/") {
		found, err := findChildBySegment(ctx, repo, ownerID, parentID, seg)
		if err != nil {
			return "", err
		}
		id = found
		parentID = &id
	}
	return id, nil
}

// findChildBySegment — pages through parentID's direct children looking for
// the one where PathSegment(title)==seg, and returns its id. Exhausting all
// pages with no match → ErrWikiNotFound.
func findChildBySegment(
	ctx context.Context, repo WikiLister, ownerID string, parentID *string, seg string,
) (string, error) {
	for offset := int32(0); ; offset += resolveChildPageLimit {
		kids, err := repo.ListChildren(ctx, ownerID, parentID, resolveChildPageLimit, offset)
		if err != nil {
			return "", fmt.Errorf("list children: %w", err)
		}
		if id, ok := segInPage(kids, seg); ok {
			return id, nil
		}
		if len(kids) < resolveChildPageLimit {
			return "", entity.ErrWikiNotFound
		}
	}
}

// segInPage — within one page of children, finds the one where
// PathSegment(title)==seg and returns its id.
func segInPage(kids []repo.WikiMeta, seg string) (string, bool) {
	for i := range kids {
		if PathSegment(kids[i].Title) == seg {
			return kids[i].ID, true
		}
	}
	return "", false
}

// resolveOutputNodeID — the output twin of ResolveWikiNodeID (output has the
// same shape as wiki, both parent_id trees); resolves path→id level by level
// from root using ListChildren meta-only.
func resolveOutputNodeID(
	ctx context.Context, repo OutputLister, ownerID, path string,
) (string, error) {
	var parentID *string
	id := ""
	for seg := range strings.SplitSeq(path, "/") {
		found, err := findOutputChildBySegment(ctx, repo, ownerID, parentID, seg)
		if err != nil {
			return "", err
		}
		id = found
		parentID = &id
	}
	return id, nil
}

func findOutputChildBySegment(
	ctx context.Context, repo OutputLister, ownerID string, parentID *string, seg string,
) (string, error) {
	for offset := int32(0); ; offset += resolveChildPageLimit {
		kids, err := repo.ListChildren(ctx, ownerID, parentID, resolveChildPageLimit, offset)
		if err != nil {
			return "", fmt.Errorf("list output children: %w", err)
		}
		if id, ok := segInOutputPage(kids, seg); ok {
			return id, nil
		}
		if len(kids) < resolveChildPageLimit {
			return "", entity.ErrOutputNotFound
		}
	}
}

func segInOutputPage(kids []repo.OutputMeta, seg string) (string, bool) {
	for i := range kids {
		if PathSegment(kids[i].Title) == seg {
			return kids[i].ID, true
		}
	}
	return "", false
}
