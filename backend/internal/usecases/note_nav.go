// note_nav.go —— genre-通用的 path→id 解析（走 NoteRepo.ListChildren 逐段下钻）。镜像
// wiki_lazy_nav.go 的 resolveWikiNodeID，但对通用 NoteRepo/NoteMeta，供 subjectivity（及日后
// 收敛的 wiki/output）复用。地址纯树派生:path 的每段 = 该层某子节点 title 的 slug。

package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/postgres"
)

func resolveNoteNodeID(
	ctx context.Context, repo *postgres.NoteRepo, ownerID, path string,
) (string, error) {
	var parentID *string
	id := ""
	for seg := range strings.SplitSeq(path, "/") {
		found, err := findNoteChildBySegment(ctx, repo, ownerID, parentID, seg)
		if err != nil {
			return "", err
		}
		id = found
		parentID = &id
	}
	return id, nil
}

func findNoteChildBySegment(
	ctx context.Context, repo *postgres.NoteRepo, ownerID string, parentID *string, seg string,
) (string, error) {
	for offset := int32(0); ; offset += resolveChildPageLimit {
		kids, err := repo.ListChildren(ctx, ownerID, parentID, resolveChildPageLimit, offset)
		if err != nil {
			return "", fmt.Errorf("list children: %w", err)
		}
		if id, ok := segInPageNote(kids, seg); ok {
			return id, nil
		}
		if len(kids) < resolveChildPageLimit {
			return "", postgres.ErrNoteNotFound
		}
	}
}

func segInPageNote(kids []postgres.NoteMeta, seg string) (string, bool) {
	for i := range kids {
		if pathSegment(kids[i].Title) == seg {
			return kids[i].ID, true
		}
	}
	return "", false
}
