// crosslink_query.go —— public /writings 渲染 [[crosslink]] 时用的查询封装。
// 让 publicroutes 不必直接 import postgres —— 通过 usecases 拿
// resolution index 和 backlink list。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/postgres"
)

// CrossLinkQueryDeps —— public /writings GET 渲 [[crosslink]] 用的查询依赖。
// 跟 WritingsTxDeps 分开，因为 public 路径不需要 Assets / tx。
type CrossLinkQueryDeps struct {
	Writings    *postgres.WritingRepo
	WritingRefs *postgres.WritingRefRepo
}

// BacklinkRef —— 一条 backlink (src writing 的 slug + title)。
type BacklinkRef struct {
	Slug  string
	Title string
}

// LoadCrossLinkIndex —— 取 owner 全部 published writing 的 (slug, title)，
// 给 `[[X]]` rewrite 用。空 owner / 无 writing → 空切片。
func LoadCrossLinkIndex(
	ctx context.Context, deps CrossLinkQueryDeps, ownerID string,
) ([]SlugTitle, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	rows, err := deps.Writings.ListPublishedSlugAndTitle(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("crosslink slug index: %w", err)
	}
	out := make([]SlugTitle, 0, len(rows))
	for i := range rows {
		out = append(out, SlugTitle{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out, nil
}

// ListBacklinks —— 列指向 writingID 的所有 published 源 writing (slug+title)。
func ListBacklinks(
	ctx context.Context, deps CrossLinkQueryDeps, ownerID, writingID string,
) ([]BacklinkRef, error) {
	if ownerID == "" || writingID == "" {
		return nil, ErrEmptyField
	}
	rows, err := deps.WritingRefs.BacklinksFor(ctx, ownerID, writingID)
	if err != nil {
		return nil, fmt.Errorf("list backlinks: %w", err)
	}
	out := make([]BacklinkRef, 0, len(rows))
	for i := range rows {
		out = append(out, BacklinkRef{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out, nil
}
