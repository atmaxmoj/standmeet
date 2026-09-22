// corpus_search_page.go — the response window for corpus_search.
//
// Split from corpus_index_socket.go (the tool wiring) to keep it under the max-lines ceiling, and
// along a real seam: this file answers "how much of the merged result comes back", the wiring
// answers "who runs and how the args parse".

package usecase

const (
	searchDefaultLimit = 20
	searchMaxLimit     = 50
)

// pageRows — apply the caller's requested [offset, offset+limit) window to the merged hits. The
// merged search returns up to four genres' hits at once, and the caller (an agent turn, or a
// microsite search widget that renders every row) reads them all — so an unbounded response is a
// wall of results, the "会炸的" case. A missing/zero limit caps at the default; a caller pages with
// offset. The genre order in the merged list is deterministic for a given query, so paging is
// stable across calls.
func pageRows(rows []Meta, offset, limit int) []Meta {
	if limit <= 0 {
		limit = searchDefaultLimit
	}
	limit = min(limit, searchMaxLimit)
	offset = max(offset, 0)
	if offset >= len(rows) {
		return []Meta{}
	}
	return rows[offset:min(offset+limit, len(rows))]
}
