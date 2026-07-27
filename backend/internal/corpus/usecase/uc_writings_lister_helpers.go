// visitor_chat_tools_writings.go —— writing 检索的 body/summary 辅助，供 pgCorpusLister
// 用(searchWritings 摘要、Get 取正文)。writing 跟 wiki/output 对称但有 path 列(读走
// GetPublishedByPath),正文转纯文本去 markdown。

package usecase

import "github.com/atmaxmoj/standmeet/internal/corpus/entity"

// writingBodyText —— writing 正文转纯文本(去 markdown),corpus_read 返这个。
func writingBodyText(w *entity.Writing) string {
	return StripMarkdown(w.Body())
}

// writingRowSummary —— corpus_search 行摘要:优先 excerpt，否则截正文。
func writingRowSummary(w *entity.Writing) string {
	if w.Excerpt() != "" {
		return Snippet(w.Excerpt())
	}
	return Snippet(writingBodyText(w))
}
