// visitor_chat_tools_posts.go —— retriever 的 post-specific 辅助。从
// visitor_chat_tools.go 拆出来守 350-line cap。posts 跟 wiki/output 共享
// search/read/list；cited footer 不收 post (post 有自己的 cross_refs +
// "ask about this essay" 入口)。

package usecases

import (
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

func (r *retriever) postMatches(p *domain.Post, q string) bool {
	return r.acl.AllowsEntry(p.Path) &&
		textMatchesQuery(q, p.Title, postBodyText(p), p.Tags)
}

func (r *retriever) listPostRow(p *domain.Post, prefix string) (corpusRow, bool) {
	if !r.acl.AllowsEntry(p.Path) || !strings.HasPrefix(p.Path, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p.Path, Title: p.Title, Kind: "post"}, true
}

func (r *retriever) findPostByPath(path string) *domain.Post {
	for i := range r.posts {
		if r.posts[i].Path == path {
			return &r.posts[i]
		}
	}
	return nil
}

func postBodyText(p *domain.Post) string {
	var b strings.Builder
	for i := range p.Body {
		if i > 0 {
			_, _ = b.WriteString(" ")
		}
		_, _ = b.WriteString(p.Body[i].Text)
	}
	return b.String()
}

func postToRow(p *domain.Post) corpusRow {
	return corpusRow{
		Path: p.Path, Title: p.Title, Kind: "post",
		Summary: postRowSummary(p),
	}
}

func postRowSummary(p *domain.Post) string {
	if p.Excerpt != "" {
		return summarize(p.Excerpt)
	}
	return summarize(postBodyText(p))
}
