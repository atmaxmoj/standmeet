// posts.go —— blog post 写入 + 渲染 use case。
//
// MCP handoff vs 手写：admin UI 走 markdown 输入 → ParseMarkdownBlocks
// 转 PostBlock 数组；MCP `post_create` 可以传 body_md (后端 parse) 或
// 直接传 blocks (AI 倾向后者，省 markdown round-trip)。两条路最终都进
// repo.Create。
//
// path 默认 "posts/<slug>"，让 visitor chat retriever 通过这个 path 读
// 文章 (用 wiki/output 同一套 path-glob ACL)。owner 想让 private post 仅
// 部分 InviteCode 看见，就给那些 code 的 corpus_permissions 加 allow
// 规则匹这条 path。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// PostsDeps —— posts 用例依赖。
type PostsDeps struct {
	Posts *postgres.PostRepo
}

// CreatePostInput —— 写入入参。Body 二选一：Blocks (优先) 或 BodyMD
// (后端 parse)。两者都空 → 空 body。
type CreatePostInput struct {
	CoverImageAssetID *string
	OwnerID           string
	Slug              string
	Title             string
	Excerpt           string
	CoverHeadline     string
	CoverSub          string
	CoverHue          string
	Visibility        string
	Path              string
	LockedBody        string
	BodyMD            string
	Body              []domain.PostBlock
	Tags              []string
	CrossRefs         []string
	Publish           bool
}

// CreatePost —— 新建 post。slug 冲突翻 ErrPostSlugTaken。Publish=true 一并
// 立刻 publish (绕过手动 PublishPost 两步)。
func CreatePost(
	ctx context.Context, deps PostsDeps, in *CreatePostInput,
) (domain.Post, error) {
	if verr := validatePostInput(in); verr != nil {
		return domain.Post{}, verr
	}
	repoIn := buildRepoCreateInput(in)
	post, err := deps.Posts.Create(ctx, repoIn)
	if err != nil {
		if errors.Is(err, domain.ErrPostSlugTaken) {
			return domain.Post{}, domain.ErrPostSlugTaken
		}
		return domain.Post{}, fmt.Errorf("create post: %w", err)
	}
	return post, nil
}

func validatePostInput(in *CreatePostInput) error {
	if in.OwnerID == "" || in.Slug == "" || in.Title == "" {
		return ErrEmptyField
	}
	return nil
}

func buildRepoCreateInput(in *CreatePostInput) *postgres.CreatePostInput {
	body := in.Body
	if len(body) == 0 && in.BodyMD != "" {
		body = ParseMarkdownBlocks(in.BodyMD)
	}
	path := in.Path
	if path == "" {
		path = "posts/" + in.Slug
	}
	return &postgres.CreatePostInput{
		OwnerID: in.OwnerID, Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt,
		Body: body, CoverHeadline: in.CoverHeadline, CoverSub: in.CoverSub,
		CoverHue: in.CoverHue, CoverImageAssetID: in.CoverImageAssetID,
		Tags: in.Tags, Visibility: in.Visibility, CrossRefs: in.CrossRefs,
		Path: path, ReadMinutes: estimateReadMinutes(body),
		LockedBody: in.LockedBody, Publish: in.Publish,
	}
}

// UpdatePostInput —— 更新；slug / publish 状态保留。
type UpdatePostInput struct {
	CoverImageAssetID *string
	OwnerID           string
	PostID            string
	Title             string
	Excerpt           string
	CoverHeadline     string
	CoverSub          string
	CoverHue          string
	Visibility        string
	Path              string
	LockedBody        string
	BodyMD            string
	Body              []domain.PostBlock
	Tags              []string
	CrossRefs         []string
}

// UpdatePost —— admin 编辑保存。
func UpdatePost(
	ctx context.Context, deps PostsDeps, in *UpdatePostInput,
) (domain.Post, error) {
	if in.OwnerID == "" || in.PostID == "" || in.Title == "" {
		return domain.Post{}, ErrEmptyField
	}
	repoIn := buildRepoUpdateInput(in)
	post, err := deps.Posts.Update(ctx, repoIn)
	if err != nil {
		return domain.Post{}, fmt.Errorf("update post: %w", err)
	}
	return post, nil
}

func buildRepoUpdateInput(in *UpdatePostInput) *postgres.UpdatePostInput {
	body := in.Body
	if len(body) == 0 && in.BodyMD != "" {
		body = ParseMarkdownBlocks(in.BodyMD)
	}
	return &postgres.UpdatePostInput{
		OwnerID: in.OwnerID, PostID: in.PostID, Title: in.Title,
		Excerpt: in.Excerpt, Body: body, CoverHeadline: in.CoverHeadline,
		CoverSub: in.CoverSub, CoverHue: in.CoverHue,
		CoverImageAssetID: in.CoverImageAssetID,
		Tags:              in.Tags, Visibility: in.Visibility, CrossRefs: in.CrossRefs,
		Path: in.Path, ReadMinutes: estimateReadMinutes(body), LockedBody: in.LockedBody,
	}
}

// PublishPost —— 草稿 → 已发布。
func PublishPost(
	ctx context.Context, deps PostsDeps, ownerID, postID string,
) (domain.Post, error) {
	if ownerID == "" || postID == "" {
		return domain.Post{}, ErrEmptyField
	}
	p, err := deps.Posts.Publish(ctx, ownerID, postID)
	if err != nil {
		return domain.Post{}, fmt.Errorf("publish post: %w", err)
	}
	return p, nil
}

// UnpublishPost —— 撤回到草稿。
func UnpublishPost(
	ctx context.Context, deps PostsDeps, ownerID, postID string,
) (domain.Post, error) {
	if ownerID == "" || postID == "" {
		return domain.Post{}, ErrEmptyField
	}
	p, err := deps.Posts.Unpublish(ctx, ownerID, postID)
	if err != nil {
		return domain.Post{}, fmt.Errorf("unpublish post: %w", err)
	}
	return p, nil
}

// DeletePost —— 物理删。
func DeletePost(ctx context.Context, deps PostsDeps, ownerID, postID string) error {
	if ownerID == "" || postID == "" {
		return ErrEmptyField
	}
	if err := deps.Posts.Delete(ctx, ownerID, postID); err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	return nil
}

// ListAllPosts —— admin list 含草稿；按 published_at desc nulls last。
func ListAllPosts(
	ctx context.Context, deps PostsDeps, ownerID string,
) ([]domain.Post, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	rows, err := deps.Posts.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list posts: %w", err)
	}
	return rows, nil
}

// ListPublishedPosts —— public list 仅 already-published。
func ListPublishedPosts(
	ctx context.Context, deps PostsDeps, ownerID string,
) ([]domain.Post, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	rows, err := deps.Posts.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list published posts: %w", err)
	}
	return rows, nil
}

// ListPublishedPostsPageInput —— 分页入参打包。
type ListPublishedPostsPageInput struct {
	Cursor  *time.Time
	OwnerID string
	Limit   int32
}

// ListPublishedPostsPageResult —— page + 下一页 cursor (nil = 已无更多)。
type ListPublishedPostsPageResult struct {
	NextCursor *time.Time
	Posts      []domain.Post
}

// DefaultPostsPageLimit —— /api/v1/posts 默认 page size。
const DefaultPostsPageLimit = 12

// MaxPostsPageLimit —— ?limit= 上限，防 DoS。
const MaxPostsPageLimit = 50

// ListPublishedPostsPage —— infinite scroll 用。多取一条判断 has_more。
func ListPublishedPostsPage(
	ctx context.Context, deps PostsDeps, in *ListPublishedPostsPageInput,
) (ListPublishedPostsPageResult, error) {
	if in.OwnerID == "" {
		return ListPublishedPostsPageResult{}, ErrEmptyField
	}
	limit := clampPostsLimit(in.Limit)
	rows, err := deps.Posts.ListPublishedPageByOwner(ctx, &postgres.ListPublishedPageInput{
		OwnerID: in.OwnerID, Cursor: in.Cursor, Limit: limit + 1,
	})
	if err != nil {
		return ListPublishedPostsPageResult{}, fmt.Errorf("list page: %w", err)
	}
	return buildPostsPageResult(rows, limit), nil
}

func clampPostsLimit(limit int32) int32 {
	if limit <= 0 {
		return DefaultPostsPageLimit
	}
	if limit > MaxPostsPageLimit {
		return MaxPostsPageLimit
	}
	return limit
}

func buildPostsPageResult(rows []domain.Post, limit int32) ListPublishedPostsPageResult {
	if int32(len(rows)) <= limit {
		return ListPublishedPostsPageResult{Posts: rows}
	}
	page := rows[:limit]
	last := page[len(page)-1]
	cursor := last.PublishedAt
	return ListPublishedPostsPageResult{Posts: page, NextCursor: cursor}
}

// GetPostBySlug —— public article view 用。
func GetPostBySlug(
	ctx context.Context, deps PostsDeps, ownerID, slug string,
) (domain.Post, error) {
	if ownerID == "" || slug == "" {
		return domain.Post{}, ErrEmptyField
	}
	p, err := deps.Posts.GetBySlug(ctx, ownerID, slug)
	if err != nil {
		return domain.Post{}, fmt.Errorf("get post: %w", err)
	}
	return p, nil
}

// PublishedAtRFC3339 —— admin / public route 共用的时间格式化。
func PublishedAtRFC3339(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}
