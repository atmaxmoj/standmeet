// uc_lister_helpers.go —— corpus-data 塑形 helper：搜索摘要截断 + 一页上限。
// 原先散在 visitor_chat_tools*，本是 pgCorpusLister 的支撑，随 lister 归 corpus。

package usecase

import "strings"

// snippetMaxChars —— corpus_search 摘要截断上限。
const snippetMaxChars = 160

// SearchPageLimit —— corpus_search 一页上限（翻页留给 LLM 用 offset，当前固定首页）。
const SearchPageLimit = 20

// ListPageLimit —— corpus_list 一页上限。
const ListPageLimit = 50

// Snippet —— 截断到 snippetMaxChars，给 corpus_search 摘要 / writing 行摘要用。
func Snippet(body string) string {
	trimmed := strings.TrimSpace(body)
	if len(trimmed) <= snippetMaxChars {
		return trimmed
	}
	return trimmed[:snippetMaxChars] + "…"
}
