// writings.go —— owner 公开作品 (writing) 写入 + 渲染 use case。
//
// 单一存储形态：markdown。admin Tiptap 编辑器 round-trip markdown，MCP
// `writing_create` 直接接 markdown。两条路都走同一个 BodyMD 字段进 repo.Create。
//
// path 默认 "writings/<slug>"，让 visitor chat retriever 通过这个 path 读
// 文章 (用 wiki/output 同一套 path-glob ACL)。owner 想让 private writing
// 仅部分 InviteCode 看见，就给那些 code 的 corpus_permissions 加 allow
// 规则匹这条 path。

package corpus

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// WritingsDeps —— 只读 / 简单写 (publish / unpublish) 用。retriever / public
// list / mcp 用这个。
type WritingsDeps struct {
	Writings *WritingRepo
}

// WritingsTxDeps —— transactional writing CRUD (create + update + delete) 用。
// 需要 Assets 让 asset 行 + storage blob 跟 writing 同事务维护；需要
// WritingRefs 同事务重建 [[crosslink]] 边表。
type WritingsTxDeps struct {
	Writings    *WritingRepo
	WritingRefs *WritingRefRepo
	Assets      AssetsDeps
}

// PublishWriting —— 草稿 → 已发布。
func PublishWriting(
	ctx context.Context, deps WritingsDeps, ownerID, writingID string,
) (Writing, error) {
	if ownerID == "" || writingID == "" {
		return Writing{}, apierr.ErrEmptyField
	}
	p, err := deps.Writings.Publish(ctx, ownerID, writingID)
	if err != nil {
		return Writing{}, fmt.Errorf("publish writing: %w", err)
	}
	return p, nil
}

// UnpublishWriting —— 撤回到草稿。
func UnpublishWriting(
	ctx context.Context, deps WritingsDeps, ownerID, writingID string,
) (Writing, error) {
	if ownerID == "" || writingID == "" {
		return Writing{}, apierr.ErrEmptyField
	}
	p, err := deps.Writings.Unpublish(ctx, ownerID, writingID)
	if err != nil {
		return Writing{}, fmt.Errorf("unpublish writing: %w", err)
	}
	return p, nil
}

// ListAllWritings —— admin list 含草稿；按 published_at desc nulls last。
func ListAllWritings(
	ctx context.Context, deps WritingsDeps, ownerID string,
) ([]Writing, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Writings.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list writings: %w", err)
	}
	return rows, nil
}

// ListPublishedWritings —— public list 仅 already-published。
func ListPublishedWritings(
	ctx context.Context, deps WritingsDeps, ownerID string,
) ([]Writing, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Writings.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list published writings: %w", err)
	}
	return rows, nil
}

// ListPublishedWritingsPageInput —— 分页入参打包。
type ListPublishedWritingsPageInput struct {
	Cursor  *time.Time
	OwnerID string
	Limit   int32
}

// ListPublishedWritingsPageResult —— page + 下一页 cursor (nil = 已无更多)。
type ListPublishedWritingsPageResult struct {
	NextCursor *time.Time
	Writings   []Writing
}

// DefaultWritingsPageLimit —— /api/v1/writings 默认 page size。
const DefaultWritingsPageLimit = 12

// MaxWritingsPageLimit —— ?limit= 上限，防 DoS。
const MaxWritingsPageLimit = 50

// ListPublishedWritingsPage —— infinite scroll 用。多取一条判断 has_more。
func ListPublishedWritingsPage(
	ctx context.Context, deps WritingsDeps, in *ListPublishedWritingsPageInput,
) (ListPublishedWritingsPageResult, error) {
	if in.OwnerID == "" {
		return ListPublishedWritingsPageResult{}, apierr.ErrEmptyField
	}
	limit := clampWritingsLimit(in.Limit)
	rows, err := deps.Writings.ListPublishedPageByOwner(ctx, &ListPublishedPageInput{
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
	rows []Writing, limit int32,
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

// GetWritingBySlug —— public article view 用。
func GetWritingBySlug(
	ctx context.Context, deps WritingsDeps, ownerID, slug string,
) (Writing, error) {
	if ownerID == "" || slug == "" {
		return Writing{}, apierr.ErrEmptyField
	}
	p, err := deps.Writings.GetBySlug(ctx, ownerID, slug)
	if err != nil {
		return Writing{}, fmt.Errorf("get writing: %w", err)
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
