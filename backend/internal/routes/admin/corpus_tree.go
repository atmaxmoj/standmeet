// corpus_tree.go — GET /corpus/{genre}/tree?parent=ID — one lazily-loaded layer of the
// admin corpus tree (an empty parent means the root layer). Owner-scoped, stateless.
// Expanding each node fires one request; the full tree is never pulled at once, keeping
// admin scale-safe on a large corpus. The response shape is a flat list item +
// has_children (can it be drilled into). path is the root→leaf title chain slugified
// server-side (SlugifyTitle is the single source, so the frontend never computes its own
// copy — prevents drift).

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
		writeItemsJSON(h.Log, w, "encode wiki tree", items)
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
		writeItemsJSON(h.Log, w, "encode output tree", items)
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
		writeItemsJSON(h.Log, w, "encode raw tree", items)
	}
}

// rawTreeItem —— one raw tree child → list item. Shares rawItemBase so the tree view carries the
// same clean Preview / Status as the flat list (F-R-1: the tree path used to build its own item and
// leaked raw markup into the card); only the tree-specific fields are added here.
func rawTreeItem(c *corpus.TreeChild[corpus.Raw]) rawListItem {
	row := &c.Entry
	it := rawItemFromDomain(row)
	it.HasChildren = c.HasChildren
	if p := slugJoin(c.PathTitles); p != "" {
		it.Path = &p
	}
	if pid, ok := row.ParentID(); ok {
		it.ParentID = &pid
	}
	return it
}

// slugJoin — joins the root→leaf title chain into an address after slugifying;
// SlugifyTitle is the single slug source, so frontend and backend never compute it
// separately.
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

// optParent — an empty ?parent= → nil (the root layer); non-empty → a pointer.
func optParent(r *http.Request) *string {
	p := r.URL.Query().Get("parent")
	if p == "" {
		return nil
	}
	return &p
}
