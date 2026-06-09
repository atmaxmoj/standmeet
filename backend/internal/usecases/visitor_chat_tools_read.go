// visitor_chat_tools_read.go —— retriever 的 corpus_read dispatch +
// per-genre serve helpers + 跨 genre 的 ACL 评估 helper。从 visitor_chat_tools.go
// 拆出守 350-line cap。

package usecases

import (
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// allowsPath —— ACL 评估 (wiki/output 用)。走 RoleSnapshot.AllowsCorpus
// (genre://path)。genre = 调用 site (caller 已 know wiki vs output)。
func (r *retriever) allowsPath(genre domain.DocumentGenre, path string) bool {
	return r.snapshot.AllowsCorpus(domain.FormatURI(genre, path))
}

// allowsEntry —— wiki/output entry-level ACL；空 path 的 entry 也走
// AllowsCorpus，相当于评估 "<genre>://" 这条 URI —— role 配 "<genre>://**"
// 时正则 `^genre://.*$` 允许零字符尾巴，所以"owner 没填 path 也能 retrieve"
// 的旧语义保留。owner 显式收紧 (e.g. corpus_uris=['wiki://thinking/**']) 时
// 空 path 自然不匹中 → 不被检索。
func (r *retriever) allowsEntry(genre domain.DocumentGenre, path string) bool {
	return r.snapshot.AllowsCorpus(domain.FormatURI(genre, path))
}

// dispatchRead —— 按 genre 顺序找 entry，命中时按该 genre 评估 ACL。先 wiki，
// 再 output，再 writing；命中并通过 ACL 才 emit。所有 genre 都没匹中 → "not
// found"；命中但 ACL deny → "access denied"。
func (r *retriever) dispatchRead(path string) string {
	if w := r.findWikiByPath(path); w != nil {
		return r.serveWikiRead(w, path)
	}
	if o := r.findOutputByPath(path); o != nil {
		return r.serveOutputRead(o, path)
	}
	if w := r.findWritingByPath(path); w != nil {
		return r.serveWritingRead(w, path)
	}
	return errJSON("not found: " + path)
}

func (r *retriever) serveWikiRead(w *domain.Wiki, path string) string {
	if !r.allowsPath(domain.GenreWiki, path) {
		return errJSON("access denied: " + path)
	}
	r.collector.addWiki(w)
	return marshalReadResult(w.ID(), "wiki", w.Body(), path, w.Title())
}

func (r *retriever) serveOutputRead(o *domain.Output, path string) string {
	if !r.allowsPath(domain.GenreOutput, path) {
		return errJSON("access denied: " + path)
	}
	r.collector.addOutput(o)
	return marshalReadResult(o.ID(), "output", o.Body(), path, o.Title())
}

func (r *retriever) serveWritingRead(w *domain.Writing, path string) string {
	if !r.allowsPath(domain.GenreWriting, path) {
		return errJSON("access denied: " + path)
	}
	return marshalReadResult(w.ID(), "writing", writingBodyText(w), path, w.Title())
}
