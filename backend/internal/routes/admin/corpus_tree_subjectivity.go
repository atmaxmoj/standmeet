// corpus_tree_subjectivity.go — GET /corpus/subjectivity/tree?parent=ID — subjectivity's
// lazily-loaded layer.
//
// Why it didn't exist before: subjectivity was added as an ACL / retrieval partition, and
// never got an owner-side facade. So "which genre does the owner's CV live in" could
// neither be listed nor opened in admin, and there was no way to check from a tree which
// codes it's visible to (F-A-15). The ACL side had already grown a corpus URI editor, but
// it was pointing at a tree nobody had ever built.
//
// The shape is verbatim identical to wiki / output's tree (flat list item + has_children +
// a server-slugified path), so the frontend's CorpusLazyTree / admission picker can treat
// it uniformly — subjectivity isn't a special case, it's just the fifth genre.

package admin

import (
	"net/http"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// subjectivityListItem — the owner view of one subjectivity note. The fields are a subset
// of wiki's: the generic NoteRepo has no genre-specific fields, and giving fewer beats
// giving fake ones.
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

// subjectivityTreeItem — one child → list item (path goes through slugJoin, the same slug
// source as every other genre).
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
