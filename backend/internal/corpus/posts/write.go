// write.go —— the owner's writes: create, update, trash, restore. Each write records its post.*
// event in the same transaction; the event carries the id and the audience, never the body.

package posts

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/posts/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Event types —— thin: subject post/<id>, data {post_id, visibility}.
const (
	EventCreated = "post.created"
	EventUpdated = "post.updated"
	EventDeleted = "post.deleted"
)

// refKind —— a post as an asset_references referrer.
const refKind = entity.AssetRefPost

// InputError —— a write refused for its input; the message is for the owner.
type InputError struct{ Msg string }

func (e *InputError) Error() string { return e.Msg }

func badInput(msg string) error { return &InputError{Msg: msg} }

// Patch —— a write's fields. On create an omitted visibility is private; on update an omitted
// field keeps its value.
type Patch struct {
	Body           *string
	Visibility     *string
	VisibleRoleIDs *[]string
}

// Create —— a new post.
func (s *Service) Create(ctx context.Context, ownerID string, p *Patch) (Post, error) {
	cur := Post{Visibility: VisibilityDefault}
	next, err := s.apply(ctx, ownerID, &cur, p)
	if err != nil {
		return Post{}, err
	}
	return s.write(ctx, ownerID, EventCreated, func(q *db.Queries) (db.Post, error) {
		return q.CreatePost(ctx, db.CreatePostParams{
			OwnerID: pgstore.UUIDOrNull(ownerID), Body: next.Body, Visibility: next.Visibility,
			VisibleRoleIds: uuids(next.VisibleRoleIDs),
		})
	})
}

// Update —— changes a post's body and / or audience; its time stays.
func (s *Service) Update(ctx context.Context, ownerID, id string, p *Patch) (Post, error) {
	cur, err := s.Get(ctx, ownerID, OwnerViewer(), id)
	if err != nil {
		return Post{}, err
	}
	next, err := s.apply(ctx, ownerID, &cur, p)
	if err != nil {
		return Post{}, err
	}
	return s.write(ctx, ownerID, EventUpdated, func(q *db.Queries) (db.Post, error) {
		return q.UpdatePost(ctx, db.UpdatePostParams{
			OwnerID: pgstore.UUIDOrNull(ownerID), ID: pgstore.UUIDOrNull(id), Body: next.Body,
			Visibility: next.Visibility, VisibleRoleIds: uuids(next.VisibleRoleIDs),
		})
	})
}

// Trash —— deletes a post into the trash; it keeps its image references until purged.
func (s *Service) Trash(ctx context.Context, ownerID, id string) error {
	_, err := s.write(ctx, ownerID, EventDeleted, func(q *db.Queries) (db.Post, error) {
		return q.TrashPost(ctx, db.TrashPostParams{
			OwnerID: pgstore.UUIDOrNull(ownerID), ID: pgstore.UUIDOrNull(id),
		})
	})
	return err
}

// Restore —— brings a post back from the trash, same id, same time, same audience. found=false
// when no trashed post has this id (the caller tries the corpus trash next).
func (s *Service) Restore(ctx context.Context, ownerID, id string) (bool, error) {
	_, err := s.write(ctx, ownerID, EventUpdated, func(q *db.Queries) (db.Post, error) {
		return q.RestorePost(ctx, db.RestorePostParams{
			OwnerID: pgstore.UUIDOrNull(ownerID), ID: pgstore.UUIDOrNull(id),
		})
	})
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// write —— one row write and its event, in one transaction; then the post's image references.
func (s *Service) write(
	ctx context.Context, ownerID, typ string, op func(*db.Queries) (db.Post, error),
) (Post, error) {
	var out Post
	err := pgstore.InTx(ctx, s.pool, func(tx pgstore.Tx) error {
		row, werr := op(s.q.WithTx(tx))
		if werr != nil {
			return notFound(werr)
		}
		out = fromRow(&row)
		data := map[string]string{"post_id": out.ID, "visibility": out.Visibility}
		return s.events.With(tx).Record(ctx, ownerID, typ, "post/"+out.ID, data)
	})
	if err != nil {
		return Post{}, err
	}
	rerr := s.rebuildRefs(ctx, ownerID, &out)
	return out, rerr
}

// rebuildRefs —— the owner's pool images this post's body cites become its references. A trashed
// post keeps them (only the purge drops them).
func (s *Service) rebuildRefs(ctx context.Context, ownerID string, p *Post) error {
	if s.assets == nil || p.DeletedAt != nil {
		return nil
	}
	owned, err := s.assets.OwnedAssetIDs(ctx, ownerID, usecase.ScanAssetReferences(p.Body))
	if err != nil {
		return fmt.Errorf("post refs: %w", err)
	}
	if derr := s.assets.DeleteReferencesByReferrer(ctx, refKind, p.ID); derr != nil {
		return fmt.Errorf("post refs: %w", derr)
	}
	return s.insertRefs(ctx, p.ID, owned)
}

func (s *Service) insertRefs(ctx context.Context, postID string, assetIDs []string) error {
	for _, id := range assetIDs {
		if err := s.assets.InsertReference(ctx, id, refKind, postID); err != nil {
			return fmt.Errorf("post refs: %w", err)
		}
	}
	return nil
}

// apply —— the patch over the current post, validated.
func (s *Service) apply(ctx context.Context, ownerID string, cur *Post, p *Patch) (Post, error) {
	next := *cur
	next.Body = pick(p.Body, cur.Body)
	next.Visibility = pick(p.Visibility, cur.Visibility)
	next.VisibleRoleIDs = pick(p.VisibleRoleIDs, cur.VisibleRoleIDs)
	if next.Visibility != VisibilityRoles && p.VisibleRoleIDs == nil {
		next.VisibleRoleIDs = nil // leaving 'roles' drops the list the owner didn't restate
	}
	err := s.validate(ctx, ownerID, &next)
	return next, err
}

// pick —— the given value, or the current one when it was omitted.
func pick[T string | []string](given *T, cur T) T {
	if given == nil {
		return cur
	}
	return *given
}

func (s *Service) validate(ctx context.Context, ownerID string, p *Post) error {
	if strings.TrimSpace(p.Body) == "" {
		return badInput("a post needs a body")
	}
	switch p.Visibility {
	case VisibilityPrivate, VisibilityPublic:
		return noRoleList(p.VisibleRoleIDs)
	case VisibilityRoles:
		return s.validateRoles(ctx, ownerID, p.VisibleRoleIDs)
	default:
		return badInput("visibility must be 'private', 'public' or 'roles'")
	}
}

func noRoleList(ids []string) error {
	if len(ids) > 0 {
		return badInput("visible_role_ids is only for visibility 'roles'")
	}
	return nil
}

func (s *Service) validateRoles(ctx context.Context, ownerID string, ids []string) error {
	if len(ids) == 0 {
		return badInput("visibility 'roles' needs at least one role in visible_role_ids")
	}
	if err := s.roles(ctx, ownerID, ids); err != nil {
		return badInput("visible_role_ids: " + err.Error())
	}
	return nil
}

// uuids —— never nil: a nil slice binds as NULL, and the column is NOT NULL '{}'.
func uuids(ids []string) []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(ids))
	for _, id := range ids {
		out = append(out, pgstore.UUIDOrNull(id))
	}
	return out
}
