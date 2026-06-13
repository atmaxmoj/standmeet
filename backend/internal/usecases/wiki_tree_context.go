// wiki_tree_context.go —— 一个节点的"上下文":祖先链(breadcrumb)+ 直接子
// (SubEntriesRail)。跟树端点同一套 scope/effective-parent 口径,所以不在 scope
// 的祖先不出现在 breadcrumb(不泄露 gated 标题),子节点也照 scope 过滤。
//
// landing 页 SSR 拿这个画 breadcrumb + sub-rail;client 树 sidebar 走 WikiTreeChildren。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const ancestorsMaxDepth = 32

// WikiContext —— 节点上下文。Ancestors 是 root→parent 顺序(不含自己)。
type WikiContext struct {
	Ancestors []WikiTreeNode
	Children  []WikiTreeNode
}

// WikiNodeContext —— 取 path 那条的祖先链 + 直接子。path 不存在 / 不在 scope →
// 空上下文(不报错,前端不画 breadcrumb/rail)。
func WikiNodeContext(
	ctx context.Context, deps SEODeps, path string, scope WikiTreeScope,
) (WikiContext, error) {
	empty := WikiContext{Ancestors: []WikiTreeNode{}, Children: []WikiTreeNode{}}
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return empty, nil
	}
	wikis, err := deps.Wiki.ListByOwner(ctx, owner.ID, maxRAGWikis)
	if err != nil {
		return WikiContext{}, fmt.Errorf("list wiki: %w", err)
	}
	return buildWikiContext(wikis, path, scope), nil
}

// buildWikiContext —— 全树算 scope,定位 path 节点,出祖先链 + 直接子。
func buildWikiContext(wikis []domain.Wiki, path string, scope WikiTreeScope) WikiContext {
	empty := WikiContext{Ancestors: []WikiTreeNode{}, Children: []WikiTreeNode{}}
	paths := WikiTreePaths(wikis)
	inScope := scopeSet(wikis, paths, scope)
	idx, found := scopedIndexAtPath(wikis, paths, inScope, path)
	if !found {
		return empty
	}
	return WikiContext{
		Ancestors: ancestorsOf(wikis, paths, inScope, idx),
		Children:  nodesUnder(wikis, paths, inScope, wikis[idx].ID()),
	}
}

// scopedIndexAtPath —— path 命中且可见那条的下标。
func scopedIndexAtPath(
	wikis []domain.Wiki, paths map[string]string, inScope map[string]bool, path string,
) (int, bool) {
	for i := range wikis {
		id := wikis[i].ID()
		if inScope[id] && paths[id] == path {
			return i, true
		}
	}
	return 0, false
}

// ancestorsOf —— 沿 effective-parent 链上溯,收可见祖先,root→parent 排序。
func ancestorsOf(
	wikis []domain.Wiki, paths map[string]string, _ map[string]bool, idx int,
) []WikiTreeNode {
	byID := indexByID(wikis)
	chain := make([]WikiTreeNode, 0)
	cur := &wikis[idx]
	for range ancestorsMaxDepth {
		pid := effectiveParent(cur)
		parentIdx, in := byID[pid]
		if pid == "" || !in {
			break
		}
		chain = append([]WikiTreeNode{ancestorNode(&wikis[parentIdx], paths)}, chain...)
		cur = &wikis[parentIdx]
	}
	return chain
}

// ancestorNode —— breadcrumb 用,无需 has_children。
func ancestorNode(w *domain.Wiki, paths map[string]string) WikiTreeNode {
	return WikiTreeNode{ID: w.ID(), Title: w.Title(), Path: paths[w.ID()]}
}

// indexByID —— id → 下标。
func indexByID(wikis []domain.Wiki) map[string]int {
	out := make(map[string]int, len(wikis))
	for i := range wikis {
		out[wikis[i].ID()] = i
	}
	return out
}
