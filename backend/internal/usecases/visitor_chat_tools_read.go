// visitor_chat_tools_read.go —— retriever 的 corpus_read dispatch +
// per-genre serve helpers + 跨 genre 的 ACL 评估 helper。从 visitor_chat_tools.go
// 拆出守 350-line cap。

package usecases

import (
	"context"

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

// dispatchRead —— 找 viewer **有权读**的那条 entry 来 emit。同一 path 可能同时存在
// 多 genre(promote_wiki_to_output 会造同名 wiki+output → 同树派生 path);逐 genre 找
// 命中**且过 ACL** 的就 serve —— 一条被 ACL 拒的 wiki 不该挡住同 path 一条被允许的
// output。都没找到允许的:有命中(只是被拒)→ "access denied";啥都没命中 → "not found"。
func (r *retriever) dispatchRead(ctx context.Context, path string) string {
	if served := r.readAllowedGenre(ctx, path); served != "" {
		return served
	}
	if r.pathExistsAnyGenre(ctx, path) {
		return errJSON("access denied: " + path)
	}
	return errJSON("not found: " + path)
}

// readAllowedGenre —— 顺 wiki→output→writing 找命中且过 ACL 的,serve;都没有 → ""。
func (r *retriever) readAllowedGenre(ctx context.Context, path string) string {
	if s := r.readWikiIfAllowed(ctx, path); s != "" {
		return s
	}
	if s := r.readOutputIfAllowed(ctx, path); s != "" {
		return s
	}
	return r.readWritingIfAllowed(ctx, path)
}

func (r *retriever) readWikiIfAllowed(ctx context.Context, path string) string {
	w := r.findWikiByPath(ctx, path)
	if w == nil || !r.allowsPath(domain.GenreWiki, path) {
		return ""
	}
	r.collector.addWiki(w)
	return marshalReadResult(w.ID(), "wiki", w.Body(), path, w.Title())
}

func (r *retriever) readOutputIfAllowed(ctx context.Context, path string) string {
	o := r.findOutputByPath(ctx, path)
	if o == nil || !r.allowsPath(domain.GenreOutput, path) {
		return ""
	}
	r.collector.addOutput(o)
	return marshalReadResult(o.ID(), "output", o.Body(), path, o.Title())
}

func (r *retriever) readWritingIfAllowed(ctx context.Context, path string) string {
	w := r.findWritingByPath(ctx, path)
	if w == nil || !r.allowsPath(domain.GenreWriting, path) {
		return ""
	}
	return marshalReadResult(w.ID(), "writing", writingBodyText(w), path, w.Title())
}

// pathExistsAnyGenre —— path 在任一 genre 里是否存在(不论 ACL):区分 "access denied"
// 与 "not found"。
func (r *retriever) pathExistsAnyGenre(ctx context.Context, path string) bool {
	return r.findWikiByPath(ctx, path) != nil ||
		r.findOutputByPath(ctx, path) != nil ||
		r.findWritingByPath(ctx, path) != nil
}
