// wiki_tree.go —— 公开 wiki 树的懒加载分层 + ACL 过滤。wiki landing sidebar
// (#37)和 reader/writing 入口(#43)共用这一套。
//
// 懒加载:一次返一层(roots / 某节点的直接子),前端展开才取下一层 —— 大 corpus
// 不一次拉整棵。可见性走 scope:匿名只 seo_indexed,有 code 走 role corpus_uris
// glob 准入 —— **不在 scope 的条目整条不出现**(不泄露 gated 标题)。
//
// path 跟 GetWikiLanding 同口径(全树派生),前端拿 path 直接拼 /wiki/<path>。
// 一个不可见的 parent 会把它**可见**的子节点升为 root(parent 不在集合内 = root
// 边界),既不漏 gated 父名又保子节点可达。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// WikiTreeNode —— 树的一个节点(单层)。HasChildren 决定前端要不要画展开箭头。
type WikiTreeNode struct {
	ID          string
	Title       string
	Path        string
	HasChildren bool
}

// WikiTreeScope —— 判一条 wiki 对当前 viewer 是否可见。
type WikiTreeScope func(w *domain.Wiki, path string) bool

// PublicWikiScope —— 匿名:只 seo_indexed 可见(跟 GetWikiLanding 一致)。
func PublicWikiScope(w *domain.Wiki, _ string) bool {
	return w.SEOIndexed()
}

// RoleWikiScope —— 有 code:role corpus_uris glob 准入 wiki://<path>。
func RoleWikiScope(snap *domain.RoleSnapshot) WikiTreeScope {
	return func(_ *domain.Wiki, path string) bool {
		return snap.AllowsCorpus("wiki://" + path)
	}
}

// WikiTreeScopeFor —— bearer token → scope。token 空 / 无效 / 无 store 都退到
// 匿名(只 seo_indexed);有效 session → role corpus_uris scope。route 只取 token,
// 把分支下沉到这,守 routes-cyclo。
func WikiTreeScopeFor(
	ctx context.Context, sessions *session.VisitorSessionStore, token string,
) WikiTreeScope {
	snap := sessionRoleSnapshot(ctx, sessions, token)
	if snap == nil {
		return PublicWikiScope
	}
	return RoleWikiScope(snap)
}

// sessionRoleSnapshot —— token 换 RoleSnapshot;任何缺失/错误 → nil(退匿名)。
func sessionRoleSnapshot(
	ctx context.Context, sessions *session.VisitorSessionStore, token string,
) *domain.RoleSnapshot {
	if token == "" || sessions == nil {
		return nil
	}
	data, err := sessions.Get(ctx, token)
	if err != nil {
		return nil
	}
	return data.RoleSnapshot
}

// WikiTreeChildren —— 返回 parentID 的直接子节点(parentID="" → roots)。
func WikiTreeChildren(
	ctx context.Context, deps SEODeps, parentID string, scope WikiTreeScope,
) ([]WikiTreeNode, error) {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []WikiTreeNode{}, nil
	}
	wikis, err := deps.Wiki.ListByOwner(ctx, owner.ID, maxRAGWikis)
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	return buildWikiTreeLayer(wikis, parentID, scope), nil
}

// buildWikiTreeLayer —— 全树算可见集 + effective-parent,挑出 parentID 的直接子。
func buildWikiTreeLayer(
	wikis []domain.Wiki, parentID string, scope WikiTreeScope,
) []WikiTreeNode {
	paths := WikiTreePaths(wikis)
	inScope := scopeSet(wikis, paths, scope)
	return nodesUnder(wikis, paths, inScope, parentID)
}

// nodesUnder —— parentID 的直接可见子(parentID="" → roots)。paths/inScope 由
// 调用方算好,layer 与 context 共用。
func nodesUnder(
	wikis []domain.Wiki, paths map[string]string, inScope map[string]bool, parentID string,
) []WikiTreeNode {
	hasKids := parentsWithVisibleChild(wikis, inScope)
	out := make([]WikiTreeNode, 0)
	for i := range wikis {
		id := wikis[i].ID()
		if inScope[id] && effectiveParent(&wikis[i], inScope) == parentID {
			out = append(out, WikiTreeNode{
				ID: id, Title: wikis[i].Title(),
				Path: paths[id], HasChildren: hasKids[id],
			})
		}
	}
	return out
}

// scopeSet —— id → 是否可见。
func scopeSet(
	wikis []domain.Wiki, paths map[string]string, scope WikiTreeScope,
) map[string]bool {
	out := make(map[string]bool, len(wikis))
	for i := range wikis {
		id := wikis[i].ID()
		out[id] = scope(&wikis[i], paths[id])
	}
	return out
}

// effectiveParent —— parent 可见 → 真 parent;否则当 root(不可见 parent 不漏)。
func effectiveParent(w *domain.Wiki, inScope map[string]bool) string {
	pid, ok := w.ParentID()
	if ok && inScope[pid] {
		return pid
	}
	return ""
}

// parentsWithVisibleChild —— 有 ≥1 可见子的 parent id 集(算 HasChildren)。
func parentsWithVisibleChild(wikis []domain.Wiki, inScope map[string]bool) map[string]bool {
	out := make(map[string]bool)
	for i := range wikis {
		if !inScope[wikis[i].ID()] {
			continue
		}
		if p := effectiveParent(&wikis[i], inScope); p != "" {
			out[p] = true
		}
	}
	return out
}
