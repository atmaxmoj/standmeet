// writing_tree.go —— GET /api/v1/writing-tree[?parent=ID] —— reader sidebar 的
// writing 树懒加载分层。parent 空 → roots;parent=ID → ID 的直接子。public:
// 列 published writing,private 标 locked(草稿不进)。导航按 slug。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func (h *WritingHandlers) getWritingTree() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := usecases.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handleWritingErr(w, "load owner", err)
			return
		}
		writings, lerr := usecases.ListPublishedWritings(r.Context(), h.Writings, owner.ID)
		if lerr != nil {
			h.handleWritingErr(w, "list published writings", lerr)
			return
		}
		nodes := usecases.WritingTreeChildren(writings, r.URL.Query().Get("parent"))
		writeWritingTree(h.Log, w, nodes)
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

func writeWritingTree(log *slog.Logger, w http.ResponseWriter, nodes []usecases.WritingTreeNode) {
	views := make([]writingTreeNodeView, 0, len(nodes))
	for i := range nodes {
		views = append(views, writingTreeNodeView{
			ID: nodes[i].ID, Title: nodes[i].Title, Slug: nodes[i].Slug,
			HasChildren: nodes[i].HasChildren, Locked: nodes[i].Locked,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(writingTreeResponse{Nodes: views}); err != nil {
		log.Error("encode writing tree", "err", err)
	}
}
