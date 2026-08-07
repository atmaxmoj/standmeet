// wiki_tree.go —— 公开 wiki 树的**真·懒加载**分层 + ACL 过滤。wiki landing
// sidebar(#37)和 reader/writing 入口(#43)共用这一套。
//
// 懒加载是逐层的:一次只查一层(roots / 某节点的直接子,DB 端 ListChildren,
// meta-only),**不 load 整棵树**。大 corpus 不再吃 newest-50 cap。
//
// 可见性走 scope:匿名只 published,有 code 走 role corpus_uris glob 准入。
// 文件系统式 cascade:一条可见 ⟺ 它自己过闸 **且** 每个祖先都过闸 —— 祖先 gate 了
// 整条子树不可见(不泄露 gated 标题、indexed 子也不升根)。懒加载下 cascade 这样守:
// 列某 parent 的子前先顺 parent→root 验整条链可见(visibleChain),链断 → 返空层;
// 链通 → parent 已可见,子的可见性就只看子自己过不过闸。
//
// path 跟 GetWikiLanding 同口径(树派生,corpus.PathSegment(title) 顺链拼),前端拿 path
// 直接拼 /wiki/<path>。

package usecase

import (
	"context"
	"fmt"
	"slices"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// wikiTreeLayerCap —— 一层最多返多少节点。逐层懒加载下这是**单层**上限(不是全
// corpus),远松于旧的 newest-50 全树 cap。前端树暂不分页,故取一个宽值。
const wikiTreeLayerCap = 500

// WikiTreeNode —— 树的一个节点(单层)。HasChildren 决定前端要不要画展开箭头。
type WikiTreeNode struct {
	ID          string
	Title       string
	Path        string
	HasChildren bool
}

// WikiTreeScope —— 判一条 wiki(按 published + 树派生 path)对当前 viewer 是否
// 过闸。只看节点**自己**;cascade 的祖先链由 visibleChain 单独验。
type WikiTreeScope func(seoIndexed bool, path string) bool

// PublicWikiScope —— 匿名:只 published 可见(跟 GetWikiLanding 一致)。
func PublicWikiScope(seoIndexed bool, _ string) bool {
	return seoIndexed
}

// RoleWikiScope —— 有 code:role corpus_uris glob 准入 wiki://<path>。
func RoleWikiScope(snap *access.RoleSnapshot) WikiTreeScope {
	return func(_ bool, path string) bool {
		return snap.AllowsCorpus("wiki://" + path)
	}
}

// WikiTreeScopeFor —— bearer token → scope。token 空 / 无效 / 无 store 都退到
// 匿名(只 published);有效 session → role corpus_uris scope。
func WikiTreeScopeFor(
	ctx context.Context, sessions *access.VisitorSessionStore, token string,
) WikiTreeScope {
	snap := sessionRoleSnapshot(ctx, sessions, token)
	if snap == nil {
		return PublicWikiScope
	}
	return RoleWikiScope(snap)
}

// sessionRoleSnapshot —— token 换 RoleSnapshot;任何缺失/错误 → nil(退匿名)。
func sessionRoleSnapshot(
	ctx context.Context, sessions *access.VisitorSessionStore, token string,
) *access.RoleSnapshot {
	if token == "" || sessions == nil {
		return nil
	}
	data, err := sessions.Get(ctx, token)
	if err != nil {
		return nil
	}
	return data.RoleSnapshot
}

// wikiTreeQuery —— 一次树查询的公共上下文(repo + owner + scope),把 ctx 之外的
// 共参收进 receiver,守 argument-limit。
type wikiTreeQuery struct {
	repo    corpus.WikiLister
	scope   WikiTreeScope
	ownerID string
}

// WikiTreeStats —— 侧栏脚计数。Entries / Roots 是关于这个语料的事实(一共多少条、几个根);
// **Gated 是相对这位访客的**:对他关着几条。
//
// 上一版是一句 `COUNT(*) WHERE NOT published`,完全不看 session。于是一个 role 授了
// `wiki://**` 的受邀访客被告知「222 GATED」,而他随手就能打开其中任何一条 —— 同一个会话里,
// 侧栏树、条目页、检索三处都认这份 grant,只有这个计数(和 /wiki 索引)认 published 标志。
// 一个问题两道闸,而这里用错了那一道(F-L-14)。
//
// 现在按 scope 数,cascade 跟树一致:一条可见 ⟺ 它自己过闸且每个祖先都过闸。
// 一次 ListAllMeta(无 body)+ 内存里拼 path;个人语料的量级下这比"少一句 COUNT"重要得多。
func WikiTreeStats(
	ctx context.Context, deps SEODeps, scope WikiTreeScope,
) (corpus.WikiStats, error) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return corpus.WikiStats{}, nil
	}
	metas, err := deps.Wiki.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return corpus.WikiStats{}, fmt.Errorf("wiki tree stats: %w", err)
	}
	return countVisible(metas, scope), nil
}

// countVisible —— entries / roots 照实数;gated = 这位访客看不到的条数。
func countVisible(metas []corpus.WikiMeta, scope WikiTreeScope) corpus.WikiStats {
	byID := make(map[string]*corpus.WikiMeta, len(metas))
	for i := range metas {
		byID[metas[i].ID] = &metas[i]
	}
	stats := corpus.WikiStats{Entries: len(metas)}
	for i := range metas {
		if metas[i].ParentID == nil {
			stats.Roots++
		}
		if !visibleWithAncestors(byID, &metas[i], scope) {
			stats.Gated++
		}
	}
	return stats
}

// visibleWithAncestors —— 从根到自己每一级都要过闸(跟 visibleChain 同一条规则)。
// path 是顺链拼的 PathSegment,跟树、条目页用的是同一个口径。
func visibleWithAncestors(
	byID map[string]*corpus.WikiMeta, node *corpus.WikiMeta, scope WikiTreeScope,
) bool {
	chain := ancestorChain(byID, node)
	segs := make([]string, 0, len(chain))
	for _, meta := range slices.Backward(chain) {
		segs = append(segs, corpus.PathSegment(meta.Title))
		if !scope(meta.Published, strings.Join(segs, "/")) {
			return false
		}
	}
	return true
}

// ancestorChain —— node → root(自身在前)。父不在图里(理论上不该发生)就到此为止。
func ancestorChain(
	byID map[string]*corpus.WikiMeta, node *corpus.WikiMeta,
) []*corpus.WikiMeta {
	out := make([]*corpus.WikiMeta, 0, corpus.TreeMaxDepth)
	cur := node
	for range corpus.TreeMaxDepth {
		out = append(out, cur)
		if cur.ParentID == nil {
			break
		}
		parent, ok := byID[*cur.ParentID]
		if !ok {
			break
		}
		cur = parent
	}
	return out
}

// WikiTreeChildren —— 返 parentID 的直接可见子(parentID="" → roots)。非根先验
// parent 链整条可见(cascade),链断 → 空层。
func WikiTreeChildren(
	ctx context.Context, deps SEODeps, parentID string, scope WikiTreeScope,
) ([]WikiTreeNode, error) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []WikiTreeNode{}, nil
	}
	q := &wikiTreeQuery{repo: deps.Wiki, ownerID: soleOwner.ID, scope: scope}
	parentPath := ""
	if parentID != "" {
		chain, err := q.visibleChain(ctx, parentID)
		if err != nil {
			return nil, fmt.Errorf("wiki tree parent: %w", err)
		}
		if len(chain) == 0 {
			return []WikiTreeNode{}, nil // gated 祖先链 → 整条子树不可见
		}
		parentPath = chain[len(chain)-1].Path
	}
	return q.listChildren(ctx, parentID, parentPath)
}

// visibleChain —— 顺 nodeID→root 走一条链,top-down 算每节点 path + 验 scope。整条
// 都过闸 → 返 root→node(含自身)的可见节点链;任一祖先(或自身)不过闸 → 返空 slice。
func (q *wikiTreeQuery) visibleChain(
	ctx context.Context, nodeID string,
) ([]WikiTreeNode, error) {
	metas, err := q.walkToRoot(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	nodes := make([]WikiTreeNode, 0, len(metas))
	segs := make([]string, 0, len(metas))
	for _, meta := range slices.Backward(metas) {
		segs = append(segs, corpus.PathSegment(meta.Title))
		path := strings.Join(segs, "/")
		if !q.scope(meta.Published, path) {
			return []WikiTreeNode{}, nil
		}
		nodes = append(nodes, WikiTreeNode{ID: meta.ID, Title: meta.Title, Path: path})
	}
	return nodes, nil
}

// walkToRoot —— 顺 parent_id 上溯收 meta(bottom-up,不读 body),到 root 或 maxDepth。
func (q *wikiTreeQuery) walkToRoot(
	ctx context.Context, nodeID string,
) ([]corpus.WikiMeta, error) {
	out := make([]corpus.WikiMeta, 0, corpus.TreeMaxDepth)
	cur := nodeID
	for range corpus.TreeMaxDepth {
		meta, err := q.repo.GetMetaByID(ctx, q.ownerID, cur)
		if err != nil {
			return nil, fmt.Errorf("wiki meta walk: %w", err)
		}
		out = append(out, meta)
		if meta.ParentID == nil {
			break
		}
		cur = *meta.ParentID
	}
	return out, nil
}

// listChildren —— DB 列 parentID 的直接子,逐个验自己过闸(parent 已验可见)。
// has_children 是「有 ≥1 可见子」:peek 一层下去现算,无可见子 → 不画箭头。
func (q *wikiTreeQuery) listChildren(
	ctx context.Context, parentID, parentPath string,
) ([]WikiTreeNode, error) {
	kids, err := q.repo.ListChildren(ctx, q.ownerID, parentPtr(parentID), wikiTreeLayerCap, 0)
	if err != nil {
		return nil, fmt.Errorf("list wiki children: %w", err)
	}
	out := make([]WikiTreeNode, 0, len(kids))
	for i := range kids {
		path := joinSeg(parentPath, corpus.PathSegment(kids[i].Title))
		if !q.scope(kids[i].Published, path) {
			continue
		}
		hasKids, herr := q.hasVisibleChild(ctx, kids[i].ID, path)
		if herr != nil {
			return nil, herr
		}
		out = append(out, WikiTreeNode{
			ID: kids[i].ID, Title: kids[i].Title, Path: path, HasChildren: hasKids,
		})
	}
	return out, nil
}

// hasVisibleChild —— nodeID 是否有 ≥1 个过闸的直接子(nodePath 已知可见)。
func (q *wikiTreeQuery) hasVisibleChild(
	ctx context.Context, nodeID, nodePath string,
) (bool, error) {
	kids, err := q.repo.ListChildren(ctx, q.ownerID, &nodeID, wikiTreeLayerCap, 0)
	if err != nil {
		return false, fmt.Errorf("peek wiki children: %w", err)
	}
	for i := range kids {
		if q.scope(kids[i].Published, joinSeg(nodePath, corpus.PathSegment(kids[i].Title))) {
			return true, nil
		}
	}
	return false, nil
}

// parentPtr —— ""(roots)→ nil,否则 &id;喂 ListChildren 的 parentID 参数。
func parentPtr(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

func joinSeg(base, seg string) string {
	if base == "" {
		return seg
	}
	return base + "/" + seg
}
