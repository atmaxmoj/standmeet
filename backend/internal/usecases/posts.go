// posts.go —— blog post 写入 + 渲染 use case。
//
// 单一存储形态：markdown。admin Tiptap 编辑器 round-trip markdown，MCP
// `post_create` 直接接 markdown。两条路都走同一个 BodyMD 字段进 repo.Create。
//
// path 默认 "posts/<slug>"，让 visitor chat retriever 通过这个 path 读
// 文章 (用 wiki/output 同一套 path-glob ACL)。owner 想让 private post 仅
// 部分 InviteCode 看见，就给那些 code 的 corpus_permissions 加 allow
// 规则匹这条 path。

package usecases

import (
	"context"
	"fmt"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// PostsDeps —— 只读 / 简单写 (publish / unpublish) 用。retriever / public
// list / mcp 用这个。
type PostsDeps struct {
	Posts *postgres.PostRepo
}

// PostsTxDeps —— transactional post CRUD (create + update + delete) 用。
// 需要 Assets 让 asset 行 + storage blob 跟 post 同事务维护；需要
// PostLinks 同事务重建 [[crosslink]] 边表。
type PostsTxDeps struct {
	Posts     *postgres.PostRepo
	PostLinks *postgres.PostLinkRepo
	Assets    AssetsDeps
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
