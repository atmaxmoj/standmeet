// corpus_tags.go — GET /corpus/wiki/tags — every tag the genre has ever used. The grid pages
// through corpus.list (GET /corpus/{genre}?tag=&cursor=, docs/design/paging.md); this is only the
// tag row above it.

package admin

import (
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

type genreTagsResponse struct {
	Tags []string `json:"tags"`
}

// tagsWiki — every tag this genre has ever used. The panel's tag row reads this directly rather
// than deriving it from the loaded page: the latter would give no chip at all to a tag that only
// exists outside that page (the second half of F-L-23).
func (h *Handlers) tagsWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		tags, err := h.Corpus.Corpus.Wiki.ListTags(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("tags wiki", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, genreTagsResponse{Tags: tags})
	}
}
