// visitor_chat_tools_read.go —— retriever 的 read_corpus_entry dispatch +
// per-genre serve helpers + 跨 genre 的 ACL 评估 helper。从 visitor_chat_tools.go
// 拆出守 350-line cap。

package usecases

import (
	"github.com/wangsijie/standmeet/internal/domain"
)

// allowsPath —— ACL 评估 (wiki/output 用)。snapshot != nil 走
// RoleSnapshot.AllowsCorpus(uri) (genre://path)；否则 fallback PathACL。
// genre = 调用 site (caller 已 know wiki vs output)。
func (r *retriever) allowsPath(genre domain.DocumentGenre, path string) bool {
	if r.snapshot != nil {
		return r.snapshot.AllowsCorpus(domain.FormatURI(genre, path))
	}
	return r.acl.AllowsPath(path)
}

// allowsEntry —— wiki/output entry-level ACL (空 path + 空 ACL → allow，
// 空 path + 非空 ACL → deny)。snapshot 路径：corpus_uris 永远 positive-list，
// 空 path 在 URI 形态下没法匹（"wiki://" 这个空-尾巴 URI 不会落任何 pattern），
// 所以等同 deny；这跟 PathACL 的 "非空 ACL + 空 path → deny" 语义一致。
func (r *retriever) allowsEntry(genre domain.DocumentGenre, path string) bool {
	if r.snapshot != nil {
		if path == "" {
			return false
		}
		return r.snapshot.AllowsCorpus(domain.FormatURI(genre, path))
	}
	return r.acl.AllowsEntry(path)
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
	return marshalKindBody("wiki", w.Body())
}

func (r *retriever) serveOutputRead(o *domain.Output, path string) string {
	if !r.allowsPath(domain.GenreOutput, path) {
		return errJSON("access denied: " + path)
	}
	r.collector.addOutput(o)
	return marshalKindBody("output", o.Body())
}

func (r *retriever) serveWritingRead(w *domain.Writing, path string) string {
	if !r.allowsPath(domain.GenreWriting, path) {
		return errJSON("access denied: " + path)
	}
	return marshalKindBody("writing", writingBodyText(w))
}
