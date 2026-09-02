// visitor_chat_tools_writings.go —— body/summary helpers for writing retrieval, used
// by pgCorpusLister (searchWritings summaries, Get for body text). Writing is
// symmetric with wiki/output but has a path column (read via GetPublishedByPath);
// the body is converted to plain text, stripping markdown.

package usecase

import "github.com/atmaxmoj/standmeet/internal/corpus/entity"

// writingBodyText —— converts a writing's body to plain text (strips markdown);
// this is what corpus_read returns.
func writingBodyText(w *entity.Writing) string {
	return StripMarkdown(w.Body())
}

// writingRowSummary —— row summary for corpus_search: prefers excerpt, otherwise
// truncates the body.
func writingRowSummary(w *entity.Writing) string {
	if w.Excerpt() != "" {
		return Snippet(w.Excerpt())
	}
	return Snippet(writingBodyText(w))
}
