// posts.go —— posts 表 CRUD。body_md 是 markdown text 直存；
// cover_image_asset_id 可空 (typographic-only post 不挂图)。slug 冲突翻
// ErrPostSlugTaken。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// PostRepo —— posts 表 CRUD。
type PostRepo struct {
	pool *Pool
}

// NewPostRepo 构造。
func NewPostRepo(pool *Pool) *PostRepo { return &PostRepo{pool: pool} }

// CreatePostInput —— Create 入参。BodyMD 是 markdown 原文，本层透传。
type CreatePostInput struct {
	CoverImageAssetID *string
	OwnerID           string
	Slug              string
	Title             string
	Excerpt           string
	BodyMD            string
	CoverHeadline     string
	CoverSub          string
	CoverHue          string
	Visibility        string
	Path              string
	LockedBody        string
	Tags              []string
	CrossRefs         []string
	ReadMinutes       int32
	Publish           bool
}

// Create —— 新建 post 行。Publish=true 一并 published_at=now。slug 冲突翻
// ErrPostSlugTaken。
func (r *PostRepo) Create(ctx context.Context, in *CreatePostInput) (domain.Post, error) {
	params, perr := buildCreatePostParams(in)
	if perr != nil {
		return domain.Post{}, perr
	}
	row, err := dbq.New(r.pool).CreatePost(ctx, *params)
	if err != nil {
		if name, hit := pgUniqueViolation(err); hit && name == "posts_owner_slug_uniq" {
			return domain.Post{}, domain.ErrPostSlugTaken
		}
		return domain.Post{}, fmt.Errorf("create post: %w", err)
	}
	return toDomainPost(&row), nil
}

func buildCreatePostParams(in *CreatePostInput) (*dbq.CreatePostParams, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	var publishedAt pgtype.Timestamptz
	if in.Publish {
		publishedAt = nowTimestamptz()
	}
	assetID, aerr := optAssetUUID(in.CoverImageAssetID)
	if aerr != nil {
		return nil, aerr
	}
	return &dbq.CreatePostParams{
		OwnerID: ownerUUID, Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt,
		BodyMd: in.BodyMD, CoverHeadline: in.CoverHeadline, CoverSub: in.CoverSub,
		CoverHue: postCoverHueOr(in.CoverHue), CoverImageAssetID: assetID,
		Tags: nilSafeTags(in.Tags), Visibility: postVisibilityOr(in.Visibility),
		CrossRefs: nilSafeTags(in.CrossRefs), Path: in.Path,
		ReadMinutes: in.ReadMinutes, LockedBody: in.LockedBody,
		PublishedAt: publishedAt,
	}, nil
}

func optAssetUUID(id *string) (pgtype.UUID, error) {
	if id == nil || *id == "" {
		return pgtype.UUID{}, nil
	}
	u, err := parseUUID(*id)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("parse cover asset id: %w", err)
	}
	return u, nil
}

// nowTimestamptz —— published_at=now() 的便利构造。caller (Create) 已经
// 在 input.Publish=false 时不调本函数。
func nowTimestamptz() pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Now(), Valid: true}
}

// UpdatePostInput —— Update 入参。不动 slug / publish 状态 / created_at。
type UpdatePostInput struct {
	CoverImageAssetID *string
	OwnerID           string
	PostID            string
	Title             string
	Excerpt           string
	BodyMD            string
	CoverHeadline     string
	CoverSub          string
	CoverHue          string
	Visibility        string
	Path              string
	LockedBody        string
	Tags              []string
	CrossRefs         []string
	ReadMinutes       int32
}

// Update —— 全字段覆盖 (除 slug / 发布状态)。caller 已校验 owner。
func (r *PostRepo) Update(ctx context.Context, in *UpdatePostInput) (domain.Post, error) {
	params, perr := buildUpdatePostParams(in)
	if perr != nil {
		return domain.Post{}, perr
	}
	row, err := dbq.New(r.pool).UpdatePost(ctx, *params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Post{}, domain.ErrPostNotFound
		}
		return domain.Post{}, fmt.Errorf("update post: %w", err)
	}
	return toDomainPost(&row), nil
}

func buildUpdatePostParams(in *UpdatePostInput) (*dbq.UpdatePostParams, error) {
	args, perr := parseOwnerAndPostID(in.OwnerID, in.PostID)
	if perr != nil {
		return nil, perr
	}
	assetID, aerr := optAssetUUID(in.CoverImageAssetID)
	if aerr != nil {
		return nil, aerr
	}
	return &dbq.UpdatePostParams{
		ID: args.postUUID, OwnerID: args.ownerUUID,
		Title: in.Title, Excerpt: in.Excerpt, BodyMd: in.BodyMD,
		CoverHeadline: in.CoverHeadline, CoverSub: in.CoverSub,
		CoverHue: postCoverHueOr(in.CoverHue), CoverImageAssetID: assetID,
		Tags: nilSafeTags(in.Tags), Visibility: postVisibilityOr(in.Visibility),
		CrossRefs: nilSafeTags(in.CrossRefs), Path: in.Path,
		ReadMinutes: in.ReadMinutes, LockedBody: in.LockedBody,
	}, nil
}

// Publish —— published_at = now，slug/body 保留。
func (r *PostRepo) Publish(ctx context.Context, ownerID, postID string) (domain.Post, error) {
	args, perr := parseOwnerAndPostID(ownerID, postID)
	if perr != nil {
		return domain.Post{}, perr
	}
	row, err := dbq.New(r.pool).PublishPost(ctx, dbq.PublishPostParams{
		ID: args.postUUID, OwnerID: args.ownerUUID,
	})
	return toDomainPostOrErr(&row, err)
}

// Unpublish —— published_at = NULL，撤回到草稿。
func (r *PostRepo) Unpublish(ctx context.Context, ownerID, postID string) (domain.Post, error) {
	args, perr := parseOwnerAndPostID(ownerID, postID)
	if perr != nil {
		return domain.Post{}, perr
	}
	row, err := dbq.New(r.pool).UnpublishPost(ctx, dbq.UnpublishPostParams{
		ID: args.postUUID, OwnerID: args.ownerUUID,
	})
	return toDomainPostOrErr(&row, err)
}

func toDomainPostOrErr(row *dbq.Post, err error) (domain.Post, error) {
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Post{}, domain.ErrPostNotFound
		}
		return domain.Post{}, fmt.Errorf("post publish flip: %w", err)
	}
	return toDomainPost(row), nil
}

// Delete —— 物理删；FK ON DELETE SET NULL 让 cover_image_asset_id 在
// assets 删时自动清空 (反向：删 post 不删 asset，asset 可被其他 post 复用)。
func (r *PostRepo) Delete(ctx context.Context, ownerID, postID string) error {
	args, perr := parseOwnerAndPostID(ownerID, postID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(r.pool).DeletePost(ctx, dbq.DeletePostParams{
		ID: args.postUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	return nil
}

// GetByID —— admin 取单条；属于 owner 校验。
func (r *PostRepo) GetByID(ctx context.Context, ownerID, postID string) (domain.Post, error) {
	args, perr := parseOwnerAndPostID(ownerID, postID)
	if perr != nil {
		return domain.Post{}, perr
	}
	row, err := dbq.New(r.pool).GetPostByID(ctx, dbq.GetPostByIDParams{
		ID: args.postUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Post{}, domain.ErrPostNotFound
		}
		return domain.Post{}, fmt.Errorf("get post by id: %w", err)
	}
	return toDomainPost(&row), nil
}

// GetBySlug —— public 取单条；按 owner+slug 唯一索引查。
func (r *PostRepo) GetBySlug(ctx context.Context, ownerID, slug string) (domain.Post, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return domain.Post{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).GetPostBySlug(ctx, dbq.GetPostBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Post{}, domain.ErrPostNotFound
		}
		return domain.Post{}, fmt.Errorf("get post by slug: %w", err)
	}
	return toDomainPost(&row), nil
}

// ListByOwner —— admin 列表 (含未发布草稿)，按 published_at desc nulls last。
func (r *PostRepo) ListByOwner(ctx context.Context, ownerID string) ([]domain.Post, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).ListPostsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list posts by owner: %w", err)
	}
	return rowsToDomainPosts(rows), nil
}

// ListPublishedByOwner —— public list (只 already-published)；不分页 (visitor
// chat retriever 用)。
func (r *PostRepo) ListPublishedByOwner(
	ctx context.Context, ownerID string,
) ([]domain.Post, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).ListPublishedPostsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list published posts: %w", err)
	}
	return rowsToDomainPosts(rows), nil
}

// ListPublishedPageInput —— infinite-scroll 分页入参。Cursor 是上一页末
// 条 published_at；首页传 nil 拿最新 limit 条。
type ListPublishedPageInput struct {
	Cursor  *time.Time
	OwnerID string
	Limit   int32
}

// ListPublishedPageByOwner —— /api/v1/posts?cursor=...&limit=... 用。
func (r *PostRepo) ListPublishedPageByOwner(
	ctx context.Context, in *ListPublishedPageInput,
) ([]domain.Post, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	cursor := pgtype.Timestamptz{}
	if in.Cursor != nil {
		cursor = pgtype.Timestamptz{Time: *in.Cursor, Valid: true}
	}
	rows, err := dbq.New(r.pool).ListPublishedPostsByOwnerPage(ctx,
		dbq.ListPublishedPostsByOwnerPageParams{
			OwnerID: ownerUUID, Column2: cursor, Limit: in.Limit,
		})
	if err != nil {
		return nil, fmt.Errorf("list published posts page: %w", err)
	}
	return rowsToDomainPosts(rows), nil
}
