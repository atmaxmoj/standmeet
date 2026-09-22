// lister_helpers.go —— corpus-data shaping helpers: search-snippet truncation + page caps.
// Formerly scattered across visitor_chat_tools*; these back pgCorpusLister and moved
// into corpus along with the lister.

package usecase

// snippetMaxChars —— truncation cap for a corpus_search snippet.
const snippetMaxChars = 160

// SearchPageLimit —— per-page cap for corpus_search (paging via offset is left to the
// LLM; currently the first page is fixed).
const SearchPageLimit = 20

// ListPageLimit —— per-page cap for corpus_list.
const ListPageLimit = 50

// Snippet —— a corpus_search snippet or a writing-row summary, cleaned to readable prose.
//
// Delegates to SearchSnippet so the VISITOR/microsite path gets the same cleanup the owner
// side already has (F-L-45 class): this vault wraps body text in `> [!i18n]` callouts whose
// toggle is raw `<label><input type="radio">` HTML. A plain truncate here leaked that markup
// straight into the microsite search results. SearchSnippet strips the blockquote/callout/
// toggle wrapping and cuts on a character boundary (a byte slice halved a Chinese glyph).
func Snippet(body string) string {
	return SearchSnippet(body, snippetMaxChars)
}
