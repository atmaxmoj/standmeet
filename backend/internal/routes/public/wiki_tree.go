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

type wikiTreeNodeView struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Path        string `json:"path"`
	HasChildren bool   `json:"has_children"`
}

type wikiTreeResponse struct {
	Nodes []wikiTreeNodeView `json:"nodes"`
}

func writeWikiTree(log *slog.Logger, w http.ResponseWriter, nodes []usecases.WikiTreeNode) {
	views := make([]wikiTreeNodeView, 0, len(nodes))
	for i := range nodes {
		views = append(views, wikiTreeNodeView{
			ID: nodes[i].ID, Title: nodes[i].Title,
			Path: nodes[i].Path, HasChildren: nodes[i].HasChildren,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(wikiTreeResponse{Nodes: views}); err != nil {
		log.Error("encode wiki tree", "err", err)
	}
}
