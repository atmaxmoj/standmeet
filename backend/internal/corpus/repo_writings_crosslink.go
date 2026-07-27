// writings_crosslink.go —— public /writings 路径渲 `[[crosslink]]` 用的 slim
// resolution index 查询，从 writings.go 拆出来守 350-line cap。

package corpus

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SlugTitle —— ListPublishedSlugAndTitle 返的轻量元组；不带 body_md，
// 避免一次拉全 owner 的 body 重复传。
type SlugTitle struct {
	Slug  string
	Title string
}

// ListPublishedSlugAndTitle —— owner 全部 published writing 的 (slug, title)；
// public 路径渲 [[crosslink]] 用的 resolution index。
func (r *WritingRepo) ListPublishedSlugAndTitle(
	ctx context.Context, ownerID string,
) ([]SlugTitle, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).ListPublishedWritingSlugAndTitle(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list published slug+title: %w", err)
	}
	out := make([]SlugTitle, 0, len(rows))
	for i := range rows {
		out = append(out, SlugTitle{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out, nil
}
