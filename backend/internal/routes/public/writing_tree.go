// writing_tree.go —— GET /api/v1/writing-tree[?parent=ID] —— reader sidebar 的
// writing 树懒加载分层。parent 空 → roots;parent=ID → ID 的直接子。public:
// 列 published writing,private 标 locked(草稿不进)。导航按 slug。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

func (h *WritingHandlers) getWritingTree() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handleWritingErr(w, "load owner", err)
			return
		}
		writings, lerr := corpus.ListPublishedWritings(r.Context(), h.Writings, soleOwner.ID)
		if lerr != nil {
			h.handleWritingErr(w, "list published writings", lerr)
			return
		}
		nodes := corpus.WritingTreeChildren(writings, r.URL.Query().Get("parent"))
		writeWritingTree(h.Log, w, nodes)
	}
}

// getWritingTreeContext —— GET /api/v1/writing-tree/context?slug=... —— 一篇
// writing 的祖先链(breadcrumb)+ 直接子(文章页 reader 框)。
func (h *WritingHandlers) getWritingTreeContext() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handleWritingErr(w, "load owner", err)
			return
		}
		writings, lerr := corpus.ListPublishedWritings(r.Context(), h.Writings, soleOwner.ID)
		if lerr != nil {
			h.handleWritingErr(w, "list published writings", lerr)
			return
		}
		out := corpus.WritingNodeContext(writings, r.URL.Query().Get("slug"))
		writeWritingTreeContext(h.Log, w, &out)
	}
}

type writingTreeNodeView struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Slug        string `json:"slug"`
	HasChildren bool   `json:"has_children"`
	Locked      bool   `json:"locked"`
}

type writingTreeResponse struct {
	Nodes []writingTreeNodeView `json:"nodes"`
}

type writingTreeContextResponse struct {
	Ancestors []writingTreeNodeView `json:"ancestors"`
	Children  []writingTreeNodeView `json:"children"`
}

func toWritingNodeViews(nodes []corpus.WritingTreeNode) []writingTreeNodeView {
	views := make([]writingTreeNodeView, 0, len(nodes))
	for i := range nodes {
		views = append(views, writingTreeNodeView{
			ID: nodes[i].ID, Title: nodes[i].Title, Slug: nodes[i].Slug,
			HasChildren: nodes[i].HasChildren, Locked: nodes[i].Locked,
		})
	}
	return views
}

func writeWritingTree(log *slog.Logger, w http.ResponseWriter, nodes []corpus.WritingTreeNode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := writingTreeResponse{Nodes: toWritingNodeViews(nodes)}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode writing tree", "err", err)
	}
}

func writeWritingTreeContext(log *slog.Logger, w http.ResponseWriter, c *corpus.WritingContext) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := writingTreeContextResponse{
		Ancestors: toWritingNodeViews(c.Ancestors),
		Children:  toWritingNodeViews(c.Children),
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode writing tree context", "err", err)
	}
}
