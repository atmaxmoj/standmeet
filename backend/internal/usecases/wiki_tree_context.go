// wiki_tree_context.go —— 一个节点的"上下文":祖先链(breadcrumb)+ 直接子
// (SubEntriesRail)。跟树端点同一套懒加载 + cascade scope:path 顺树解成 nodeID,
// 再 visibleChain 验整条链可见 —— 不在 scope 的祖先不出现在 breadcrumb(不泄露
// gated 标题),子节点也照 scope 过滤。
//
// landing 页 SSR 拿这个画 breadcrumb + sub-rail;client 树 sidebar 走 WikiTreeChildren。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus"
)

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
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return emptyWikiContext(), nil
	}
	nodeID, err := resolveWikiNodeID(ctx, deps.Wiki, owner.ID, path)
	if err != nil {
		if errors.Is(err, corpus.ErrWikiNotFound) {
			return emptyWikiContext(), nil // path 不存在 → 空(不报错)
		}
		return WikiContext{}, fmt.Errorf("wiki context resolve: %w", err)
	}
	q := &wikiTreeQuery{repo: deps.Wiki, ownerID: owner.ID, scope: scope}
	return q.context(ctx, nodeID)
}

// context —— nodeID 的祖先链 + 直接子。节点(或任一祖先)不可见 → 空上下文。
func (q *wikiTreeQuery) context(ctx context.Context, nodeID string) (WikiContext, error) {
	chain, err := q.visibleChain(ctx, nodeID)
	if err != nil {
		return WikiContext{}, fmt.Errorf("wiki context chain: %w", err)
	}
	if len(chain) == 0 {
		return emptyWikiContext(), nil
	}
	self := chain[len(chain)-1]
	children, lerr := q.listChildren(ctx, nodeID, self.Path)
	if lerr != nil {
		return WikiContext{}, fmt.Errorf("wiki context children: %w", lerr)
	}
	return WikiContext{Ancestors: chain[:len(chain)-1], Children: children}, nil
}

func emptyWikiContext() WikiContext {
	return WikiContext{Ancestors: []WikiTreeNode{}, Children: []WikiTreeNode{}}
}
