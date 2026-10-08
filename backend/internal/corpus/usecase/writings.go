// writings.go —— owner public-writing (writing) write + render use cases.
//
// Single storage form: markdown. The admin Tiptap editor round-trips markdown, and
// the MCP `writing_create` tool takes markdown directly. Both paths land on the same
// BodyMD field going into repo.Create.
//
// Path defaults to "writings/<slug>", so the visitor chat retriever can read an
// article through that path (using the same path-glob ACL as wiki/output). If the
// owner wants a private writing visible to only some InviteCodes, they add an allow
// rule matching that path to those codes' corpus_permissions.

package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// WritingsDeps —— for read-only / simple-write (publish / unpublish) use. Used by
// the retriever, the public list, and MCP.
type WritingsDeps struct {
	Writings *repo.WritingRepo
	Events   events.Recorder // publish / unpublish: writing.* commits with the switch
}

// WritingsTxDeps —— for transactional writing CRUD (create + update + delete).
// Needs Assets so the asset row and the storage blob are maintained in the same
// transaction as the writing; needs WritingRefs to rebuild the [[crosslink]] edge
// table in that same transaction.
type WritingsTxDeps struct {
	Writings    *repo.WritingRepo
	WritingRefs *repo.WritingRefRepo
	Assets      AssetsDeps
}

// PublishWriting —— draft → published.
func PublishWriting(
	ctx context.Context, deps WritingsDeps, ownerID, writingID string,
) (entity.Writing, error) {
	if ownerID == "" || writingID == "" {
		return entity.Writing{}, apierr.ErrEmptyField
	}
	p, err := switchPublished(ctx, deps, ownerID, WritingPublished,
		func(w *repo.WritingRepo) (entity.Writing, error) {
			return w.Publish(ctx, ownerID, writingID)
		})
	if err != nil {
		return entity.Writing{}, fmt.Errorf("publish writing: %w", err)
	}
	return p, nil
}

// switchPublished —— the publish switch (write) and its writing.* event typ, in one transaction.
func switchPublished(
	ctx context.Context, deps WritingsDeps, ownerID, typ string,
	write func(w *repo.WritingRepo) (entity.Writing, error),
) (entity.Writing, error) {
	var p entity.Writing
	err := pgstore.InTx(ctx, deps.Writings.Pool(), func(tx pgstore.Tx) error {
		var werr error
		if p, werr = write(deps.Writings.With(tx)); werr != nil {
			return werr
		}
		data := map[string]string{"writing_id": p.ID(), "slug": p.Slug()}
		return deps.Events.With(tx).Record(ctx, ownerID, typ, "writing/"+p.ID(), data)
	})
	return p, err
}

// UnpublishWriting —— reverts a writing back to draft.
func UnpublishWriting(
	ctx context.Context, deps WritingsDeps, ownerID, writingID string,
) (entity.Writing, error) {
	if ownerID == "" || writingID == "" {
		return entity.Writing{}, apierr.ErrEmptyField
	}
	p, err := switchPublished(ctx, deps, ownerID, WritingUnpublished,
		func(w *repo.WritingRepo) (entity.Writing, error) {
			return w.Unpublish(ctx, ownerID, writingID)
		})
	if err != nil {
		return entity.Writing{}, fmt.Errorf("unpublish writing: %w", err)
	}
	return p, nil
}

// ListAllWritings —— one page of the admin list, drafts included, newest first (the corpus page
// query every genre reads; docs/design/paging.md), narrowed by f.
func ListAllWritings(
	ctx context.Context, deps WritingsDeps, ownerID string, f repo.NoteFilter, req paging.Request,
) (paging.Page[entity.Writing], error) {
	if ownerID == "" {
		return paging.Page[entity.Writing]{}, apierr.ErrEmptyField
	}
	page, err := deps.Writings.ListPage(ctx, ownerID, f, req)
	if err != nil {
		return paging.Page[entity.Writing]{}, fmt.Errorf("list writings: %w", err)
	}
	return paging.Each(page, func(c *repo.TreeChild[entity.Writing]) entity.Writing {
		return c.Entry
	}), nil
}

// ListPublishedWritings —— public list, already-published only.
func ListPublishedWritings(
	ctx context.Context, deps WritingsDeps, ownerID string,
) ([]entity.Writing, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Writings.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list published writings: %w", err)
	}
	return rows, nil
}

// ListPublishedWritingsPageInput —— packages the pagination input.
type ListPublishedWritingsPageInput struct {
	Cursor  *time.Time
	OwnerID string
	Limit   int32
}

// ListPublishedWritingsPageResult —— a page plus the next-page cursor (nil = no
// more results).
type ListPublishedWritingsPageResult struct {
	NextCursor *time.Time
	Writings   []entity.Writing
}

// DefaultWritingsPageLimit —— default page size for /api/v1/writings.
const DefaultWritingsPageLimit = 12

// MaxWritingsPageLimit —— ceiling on ?limit=, to prevent DoS.
const MaxWritingsPageLimit = 50

// ListPublishedWritingsPage —— for infinite scroll. Fetches one extra row to
// determine has_more.
func ListPublishedWritingsPage(
	ctx context.Context, deps WritingsDeps, in *ListPublishedWritingsPageInput,
) (ListPublishedWritingsPageResult, error) {
	if in.OwnerID == "" {
		return ListPublishedWritingsPageResult{}, apierr.ErrEmptyField
	}
	limit := clampWritingsLimit(in.Limit)
	rows, err := deps.Writings.ListPublishedPageByOwner(ctx, &repo.ListPublishedPageInput{
		OwnerID: in.OwnerID, Cursor: in.Cursor, Limit: limit + 1,
	})
	if err != nil {
		return ListPublishedWritingsPageResult{}, fmt.Errorf("list page: %w", err)
	}
	return buildWritingsPageResult(rows, limit), nil
}

func clampWritingsLimit(limit int32) int32 {
	if limit <= 0 {
		return DefaultWritingsPageLimit
	}
	if limit > MaxWritingsPageLimit {
		return MaxWritingsPageLimit
	}
	return limit
}

func buildWritingsPageResult(
	rows []entity.Writing, limit int32,
) ListPublishedWritingsPageResult {
	if int32(len(rows)) <= limit {
		return ListPublishedWritingsPageResult{Writings: rows}
	}
	page := rows[:limit]
	last := page[len(page)-1]
	var cursor *time.Time
	if pubAt, ok := last.PublishedAt(); ok {
		cp := pubAt
		cursor = &cp
	}
	return ListPublishedWritingsPageResult{Writings: page, NextCursor: cursor}
}

// GetWritingBySlug —— for the public article view. A draft answers exactly like a slug that
// isn't there (ErrWritingNotFound): the repo lookup has no published filter, and this used to
// hand a draft's whole body to anyone who guessed its slug.
func GetWritingBySlug(
	ctx context.Context, deps WritingsDeps, ownerID, slug string,
) (entity.Writing, error) {
	if ownerID == "" || slug == "" {
		return entity.Writing{}, apierr.ErrEmptyField
	}
	p, err := deps.Writings.GetBySlug(ctx, ownerID, slug)
	if err != nil {
		return entity.Writing{}, fmt.Errorf("get writing: %w", err)
	}
	if !p.IsPublished() {
		return entity.Writing{}, entity.ErrWritingNotFound
	}
	return p, nil
}

// PublishedAtRFC3339 —— time formatting shared by admin and public routes.
func PublishedAtRFC3339(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}
