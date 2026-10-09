// service.go —— the posts use cases: write (create / update / trash / restore / purge) and read
// (List / Get for a Viewer).

package posts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/posts/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// RolesExist —— a narrow port into the access domain: nil when every id is one of this owner's
// roles (a post's audience may only name real roles).
type RolesExist func(ctx context.Context, ownerID string, ids []string) error

// Service —— the posts use cases.
type Service struct {
	pool   *pgstore.Pool
	q      *db.Queries
	events events.Recorder
	assets *repo.AssetRepo
	roles  RolesExist
}

// Deps —— what the service is built from.
type Deps struct {
	Pool   *pgstore.Pool
	Events events.Recorder
	Assets *repo.AssetRepo
	Roles  RolesExist
}

// New —— the service.
func New(d *Deps) *Service {
	return &Service{
		pool: d.Pool, q: db.New(d.Pool), events: d.Events, assets: d.Assets, roles: d.Roles,
	}
}

// Filter —— a list's own filters: an audience (owner only) and a text query.
type Filter struct {
	Visibility string
	Q          string
}

// List —— one page of what the viewer may see, newest first, with the total across pages.
func (s *Service) List(
	ctx context.Context, ownerID string, v Viewer, f Filter, req paging.Request,
) (paging.Page[Post], error) {
	if !v.Owner {
		f.Visibility = "" // an audience filter is the owner's tool; a reader's audience is the rule
	}
	arg := db.ListPostsParams{
		OwnerID: pgstore.UUIDOrNull(ownerID), OwnerView: v.Owner, RoleID: v.RoleID,
		Visibility: f.Visibility, Q: f.Q, Lim: req.Fetch(),
	}
	if req.After != nil {
		arg.AfterAt = pgstore.ToTimestamptz(&req.After.At)
		arg.AfterID = pgstore.UUIDOrNull(req.After.ID)
	}
	rows, err := s.q.ListPosts(ctx, arg)
	if err != nil {
		return paging.Page[Post]{}, fmt.Errorf("list posts: %w", err)
	}
	total, err := s.q.CountPosts(ctx, db.CountPostsParams{
		OwnerID: arg.OwnerID, OwnerView: v.Owner, RoleID: v.RoleID,
		Visibility: f.Visibility, Q: f.Q,
	})
	if err != nil {
		return paging.Page[Post]{}, fmt.Errorf("count posts: %w", err)
	}
	page := paging.Cut(fromRows(rows), req, func(p *Post) paging.Cursor {
		return paging.Cursor{At: p.CreatedAt, ID: p.ID}
	})
	return page.WithTotal(total), nil
}

// Get —— one post, if the viewer may see it; ErrNotFound otherwise (missing or invisible alike).
func (s *Service) Get(ctx context.Context, ownerID string, v Viewer, id string) (Post, error) {
	row, err := s.q.GetPost(ctx, db.GetPostParams{
		OwnerID: pgstore.UUIDOrNull(ownerID), ID: pgstore.UUIDOrNull(id),
		OwnerView: v.Owner, RoleID: v.RoleID,
	})
	if err != nil {
		return Post{}, notFound(err)
	}
	return fromRow(&row), nil
}

// AssetURLs —— the signed serve URL of every image a post's body cites. Only a caller that was
// allowed to read the post renders it, so signing here is what lets that image load.
func (s *Service) AssetURLs(ctx context.Context, p *Post) map[string]string {
	if s.assets == nil {
		return map[string]string{}
	}
	urls, err := usecase.ResolveAssetURLs(ctx, s.assets, usecase.ScanAssetReferences(p.Body))
	if err != nil {
		return map[string]string{}
	}
	return urls
}

// Trashed —— the owner's deleted posts still in the trash, newest deletion first.
func (s *Service) Trashed(ctx context.Context, ownerID string) ([]Post, error) {
	rows, err := s.q.ListTrashedPosts(ctx, pgstore.UUIDOrNull(ownerID))
	if err != nil {
		return nil, fmt.Errorf("list trashed posts: %w", err)
	}
	return fromRows(rows), nil
}

// Purge —— drops posts deleted before `before`, and their image references.
func (s *Service) Purge(ctx context.Context, before time.Time) error {
	ids, err := s.q.PurgePosts(ctx, pgstore.ToTimestamptz(&before))
	if err != nil {
		return fmt.Errorf("purge posts: %w", err)
	}
	for _, id := range pgstore.FormatUUIDList(ids) {
		if derr := s.assets.DeleteReferencesByReferrer(ctx, refKind, id); derr != nil {
			return fmt.Errorf("purge post refs: %w", derr)
		}
	}
	return nil
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return fmt.Errorf("get post: %w", err)
}
