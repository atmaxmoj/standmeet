// corpus_tree.go —— GET /corpus/{genre}/tree?parent=ID —— admin 语料树的懒加载一层
// (parent 空 = 根层)。owner-scoped、全状态。每展开一个节点发一次请求,永不一次性拉全树,
// 让 admin 在大 corpus 下 scale-safe。返回结构 = flat list item + has_children（能否下钻）。
// path 由 root→leaf 标题链服务端 slug（SlugifyTitle 唯一源,不与前端各算，防 drift）。

package admin

import (
	"net/http"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

func (h *Handlers) treeWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.Corpus.Corpus.Wiki.ListChildrenTree(r.Context(), ownerID, optParent(r))
		if err != nil {
			h.Log.Error("tree wiki", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		items := make([]wikiListItem, 0, len(rows))
		for i := range rows {
			it := wikiItemFromDomain(&rows[i].Entry, slugJoin(rows[i].PathTitles))
			it.HasChildren = rows[i].HasChildren
			items = append(items, it)
		}
		writeWikiListJSON(h.Log, w, items)
	}
}

func (h *Handlers) treeOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.Corpus.Corpus.Output.ListChildrenTree(r.Context(), ownerID, optParent(r))
		if err != nil {
			h.Log.Error("tree output", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		items := make([]outputListItem, 0, len(rows))
		for i := range rows {
			it := outputItemFromDomain(&rows[i].Entry, slugJoin(rows[i].PathTitles))
			it.HasChildren = rows[i].HasChildren
			items = append(items, it)
		}
		writeOutputListJSON(h.Log, w, items)
	}
}

func (h *Handlers) treeRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.Corpus.Corpus.Raw.ListChildrenTree(r.Context(), ownerID, optParent(r))
		if err != nil {
			h.Log.Error("tree raw", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		items := make([]rawListItem, 0, len(rows))
		for i := range rows {
			items = append(items, rawTreeItem(&rows[i]))
		}
		writeRawListJSON(h.Log, w, items)
	}
}

// rawTreeItem —— one raw tree child → list item. Shares rawItemBase so the tree view carries the
// same clean Preview / Status as the flat list (F-R-1: the tree path used to build its own item and
// leaked raw markup into the card); only the tree-specific fields are added here.
func rawTreeItem(c *corpus.TreeChild[corpus.Raw]) rawListItem {
	row := &c.Entry
	it := rawItemBase(row)
	it.HasChildren = c.HasChildren
	if p := slugJoin(c.PathTitles); p != "" {
		it.Path = &p
	}
	if pid, ok := row.ParentID(); ok {
		it.ParentID = &pid
	}
	return it
}

// slugJoin —— root→leaf 标题链 slug 后拼成地址;SlugifyTitle 是唯一 slug 源,前后端不各算。
func slugJoin(titles []string) string {
	if len(titles) == 0 {
		return ""
	}
	segs := make([]string, len(titles))
	for i, t := range titles {
		segs[i] = corpus.SlugifyTitle(t)
	}
	return strings.Join(segs, "/")
}

// optParent —— ?parent= 空 → nil（根层），非空 → 指针。
func optParent(r *http.Request) *string {
	p := r.URL.Query().Get("parent")
	if p == "" {
		return nil
	}
	return &p
}
