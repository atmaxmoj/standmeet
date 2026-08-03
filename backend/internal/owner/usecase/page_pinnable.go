// page_pinnable.go —— 哪些语料条目可以被 pin 到主页。
//
// 规则是 pinned ⊆ published:只有已公开的 wiki 条目能上主页。这条规则本来长在面板那个
// 候选列表的 handler 里(它自己过滤 published、自己算树路径),于是 owner 从 Claude Code
// 问"我能 pin 什么"是问不到的 —— 那个面根本没有这件事。规则跟着 pin 走,不跟着某个面走。

package usecase

import (
	"context"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// PinnableEntry —— 一个可 pin 的候选:id、标题、以及它在阅读器里的地址。
type PinnableEntry struct {
	ID    string
	Title string
	Path  string
}

// ListPinnable —— 列出可以 pin 到主页的条目(已公开的 wiki)。
func ListPinnable(
	ctx context.Context, deps PagePinDeps, ownerID string,
) ([]PinnableEntry, error) {
	metas, err := deps.Wiki.ListAllMeta(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list pinnable: %w", err)
	}
	paths := corpus.WikiMetaTreePaths(metas)
	items := []PinnableEntry{}
	for i := range metas {
		if !metas[i].Published {
			continue // pinned ⊆ published
		}
		items = append(items, PinnableEntry{
			ID: metas[i].ID, Title: metas[i].Title, Path: paths[metas[i].ID],
		})
	}
	return items, nil
}
