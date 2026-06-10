// wiki_tree.go —— GET /api/v1/wiki-tree[?parent=ID] —— sidebar 导航的懒加载
// 分层。parent 空 → roots;parent=ID → ID 的直接子节点。一次一层,前端展开才取。
//
// scope:带有效 bearer(code session)→ role corpus_uris;否则匿名 → seo_indexed。
// token 无效/缺失都安全退到匿名(公开端点,不报 401)。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func (h *SEOHandlers) getWikiTree() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, _ := bearerToken(r)
		scope := usecases.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		nodes, err := usecases.WikiTreeChildren(
			r.Context(), h.Deps, r.URL.Query().Get("parent"), scope,
		)
		if err != nil {
			h.Log.Error("wiki tree", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWikiTree(h.Log, w, nodes)
	}
}

// getWikiTreeContext —— GET /api/v1/wiki-tree/context?path=... —— 某条目的祖先链
// (breadcrumb)+ 直接子(SubEntriesRail)。scope 同 wiki-tree。
func (h *SEOHandlers) getWikiTreeContext() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, _ := bearerToken(r)
		scope := usecases.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		out, err := usecases.WikiNodeContext(
			r.Context(), h.Deps, r.URL.Query().Get("path"), scope,
		)
		if err != nil {
			h.Log.Error("wiki tree context", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWikiTreeContext(h.Log, w, &out)
	}
}

type wikiTreeNodeView struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Path        string `json:"path"`
	HasChildren bool   `json:"has_children"`
}

type wikiTreeResponse struct {
	Nodes []wikiTreeNodeView `json:"nodes"`
}

type wikiTreeContextResponse struct {
	Ancestors []wikiTreeNodeView `json:"ancestors"`
	Children  []wikiTreeNodeView `json:"children"`
}

func writeWikiTreeContext(log *slog.Logger, w http.ResponseWriter, ctx *usecases.WikiContext) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := wikiTreeContextResponse{
		Ancestors: toNodeViews(ctx.Ancestors),
		Children:  toNodeViews(ctx.Children),
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode wiki tree context", "err", err)
	}
}

func writeWikiTree(log *slog.Logger, w http.ResponseWriter, nodes []usecases.WikiTreeNode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(wikiTreeResponse{Nodes: toNodeViews(nodes)}); err != nil {
		log.Error("encode wiki tree", "err", err)
	}
}

func toNodeViews(nodes []usecases.WikiTreeNode) []wikiTreeNodeView {
	views := make([]wikiTreeNodeView, 0, len(nodes))
	for i := range nodes {
		views = append(views, wikiTreeNodeView{
			ID: nodes[i].ID, Title: nodes[i].Title,
			Path: nodes[i].Path, HasChildren: nodes[i].HasChildren,
		})
	}
	return views
}
