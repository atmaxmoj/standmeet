// note_nav.go — genre-agnostic path→id resolution (descends segment by segment via
// NoteRepo.ListChildren). Mirrors wiki_lazy_nav.go's ResolveWikiNodeID, but for the
// generic NoteRepo/NoteMeta, so subjectivity (and wiki/output once they converge onto it
// later) can reuse it. The address is purely tree-derived: each path segment is the slug
// of some child node's title at that level.

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

func resolveNoteNodeID(
	ctx context.Context, notes *repo.NoteRepo, ownerID, path string,
) (string, error) {
	var parentID *string
	id := ""
	for seg := range strings.SplitSeq(path, "/") {
		found, err := findNoteChildBySegment(ctx, notes, ownerID, parentID, seg)
		if err != nil {
			return "", err
		}
		id = found
		parentID = &id
	}
	return id, nil
}

func findNoteChildBySegment(
	ctx context.Context, notes *repo.NoteRepo, ownerID string, parentID *string, seg string,
) (string, error) {
	for offset := int32(0); ; offset += resolveChildPageLimit {
		kids, err := notes.ListChildren(ctx, ownerID, parentID, resolveChildPageLimit, offset)
		if err != nil {
			return "", fmt.Errorf("list children: %w", err)
		}
		if id, ok := segInPageNote(kids, seg); ok {
			return id, nil
		}
		if len(kids) < resolveChildPageLimit {
			return "", repo.ErrNoteNotFound
		}
	}
}

func segInPageNote(kids []repo.NoteMeta, seg string) (string, bool) {
	for i := range kids {
		if PathSegment(kids[i].Title) == seg {
			return kids[i].ID, true
		}
	}
	return "", false
}
