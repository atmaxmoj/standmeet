// corpus_tree_subjectivity.go —— GET /corpus/subjectivity/tree?parent=ID —— subjectivity 的懒加载一层。
//
// 为什么它此前不存在:subjectivity 是作为 ACL / 检索的一个 partition 加进来的,从没有过 owner 侧的
// 面。于是「owner 的 CV 住在哪个 genre」在 admin 里既列不出也点不开,更没法从树上勾它对哪张码可见
// (F-A-15)。ACL 那边先长出了 corpus URI 的编辑器,却指望着一棵没人建过的树。
//
// 形状与 wiki / output 的 tree 逐字一致(flat list item + has_children + 服务端 slug 过的 path),
// 好让前端的 CorpusLazyTree / 准入 picker 一视同仁 —— subjectivity 不是特例,它只是第五个 genre。

package admin

import (
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

// subjectivityListItem —— 一条 subjectivity 笔记的 owner 视图。字段是 wiki 那份的子集:
// 通用 NoteRepo 没有 genre 专属字段,少给不如给假的。
type subjectivityListItem struct {
	ParentID     *string  `json:"parent_id"`
	Path         *string  `json:"path"`
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Tags         []string `json:"tags"`
	ShowAsSource bool     `json:"show_as_source"`
	HasChildren  bool     `json:"has_children,omitempty"`
}

func (h *Handlers) treeSubjectivity() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		subj := h.Corpus.Corpus.Subjectivity
		rows, err := subj.ListChildrenTree(r.Context(), ownerID, optParent(r))
		if err != nil {
			h.Log.Error("tree subjectivity", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		items := make([]subjectivityListItem, 0, len(rows))
		for i := range rows {
			items = append(items, subjectivityTreeItem(&rows[i]))
		}
		writeJSON(h.Log, w, items)
	}
}

// subjectivityTreeItem —— one child → list item（path 走 slugJoin，与其它 genre 同一个 slug 源）。
func subjectivityTreeItem(c *corpus.TreeChild[corpus.Note]) subjectivityListItem {
	n := &c.Entry
	it := subjectivityListItem{
		ID:           n.ID,
		Title:        n.Title,
		Tags:         ensureSlice(n.Tags),
		ShowAsSource: n.ShowAsSource,
		HasChildren:  c.HasChildren,
		ParentID:     n.ParentID,
	}
	if p := slugJoin(c.PathTitles); p != "" {
		it.Path = &p
	}
	return it
}
