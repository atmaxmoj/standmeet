// lister_helpers.go —— corpus-data shaping helpers: search-snippet truncation + page caps.
// Formerly scattered across visitor_chat_tools*; these back pgCorpusLister and moved
// into corpus along with the lister.

package usecase

import "strings"

// snippetMaxChars —— truncation cap for a corpus_search snippet.
const snippetMaxChars = 160

// SearchPageLimit —— per-page cap for corpus_search (paging via offset is left to the
// LLM; currently the first page is fixed).
const SearchPageLimit = 20

// ListPageLimit —— per-page cap for corpus_list.
const ListPageLimit = 50

// Snippet —— truncates to snippetMaxChars, for a corpus_search snippet or a
// writing-row summary.
func Snippet(body string) string {
	trimmed := strings.TrimSpace(body)
	if len(trimmed) <= snippetMaxChars {
		return trimmed
	}
	return trimmed[:snippetMaxChars] + "…"
}
