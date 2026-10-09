// reader.go —— the visitor corpus tools' view of posts (usecase.PostsReader): what a role may see,
// as corpus rows. A post's title is its time — it has no other — and its body is its text.

package posts

import (
	"context"
	"log/slog"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

// toolPage —— posts per corpus_list page; allCap —— the most a grep scans.
const (
	toolPage = 50
	allCap   = 1000
)

// Reader —— Service as a usecase.PostsReader.
type Reader struct{ s *Service }

// NewReader —— the reader the visitor corpus tools use.
func NewReader(s *Service) *Reader { return &Reader{s: s} }

// Search —— the visible posts whose text matches.
func (r *Reader) Search(ctx context.Context, ownerID, roleID, query string) []usecase.Meta {
	return metas(r.window(ctx, ownerID, roleID, Filter{Q: query}, window{limit: toolPage}))
}

// List —— one page of the visible timeline, newest first.
func (r *Reader) List(ctx context.Context, ownerID, roleID string, page int) []usecase.Meta {
	w := window{limit: toolPage, skip: max(page, 0)}
	return metas(r.window(ctx, ownerID, roleID, Filter{}, w))
}

// Get —— one visible post as a corpus entry.
func (r *Reader) Get(ctx context.Context, ownerID, roleID, id string) (usecase.Entry, bool) {
	p, err := r.s.Get(ctx, ownerID, Viewer{RoleID: roleID}, id)
	if err != nil {
		return usecase.Entry{}, false
	}
	return entry(&p), true
}

// All —— every visible post (capped), for grep.
func (r *Reader) All(ctx context.Context, ownerID, roleID string) []usecase.Entry {
	posts := r.window(ctx, ownerID, roleID, Filter{}, window{limit: allCap})
	out := make([]usecase.Entry, 0, len(posts))
	for i := range posts {
		out = append(out, entry(&posts[i]))
	}
	return out
}

// window —— which page of how many.
type window struct {
	limit int32
	skip  int
}

func (r *Reader) window(ctx context.Context, ownerID, roleID string, f Filter, w window) []Post {
	req := paging.Request{Limit: w.limit}
	for range w.skip {
		if req.After = r.fetch(ctx, ownerID, roleID, f, req).after(); req.After == nil {
			return []Post{} // the timeline ended before the page asked for
		}
	}
	return r.fetch(ctx, ownerID, roleID, f, req).Items
}

func (r *Reader) fetch(
	ctx context.Context, ownerID, roleID string, f Filter, req paging.Request,
) toolPageOf {
	p, err := r.s.List(ctx, ownerID, Viewer{RoleID: roleID}, f, req)
	if err != nil {
		slog.Default().Warn("posts: tool read failed", "err", err)
		return toolPageOf{}
	}
	return toolPageOf(p)
}

// toolPageOf —— a page the tools walk; a failed read is an empty, final page.
type toolPageOf paging.Page[Post]

func (p toolPageOf) after() *paging.Cursor {
	c, err := paging.Decode(p.NextCursor)
	if err != nil {
		return nil
	}
	return c
}

func entry(p *Post) usecase.Entry {
	return usecase.Entry{
		ID: p.ID, Path: PathPrefix + p.ID, Title: title(p), Genre: Genre, Body: p.Body,
		ShowAsSource: true, Published: p.Visibility == VisibilityPublic,
	}
}

func metas(posts []Post) []usecase.Meta {
	out := make([]usecase.Meta, 0, len(posts))
	for i := range posts {
		out = append(out, usecase.Meta{
			ID: posts[i].ID, Path: PathPrefix + posts[i].ID, Title: title(&posts[i]),
			Genre: Genre, Snippet: Excerpt(posts[i].Body),
		})
	}
	return out
}

// excerptRunes —— how much of a post stands in where a snippet or a title goes.
const excerptRunes = 200

// Excerpt —— a post's opening words, its text as written (whitespace folded). Not the notes'
// markdown-stripping snippet: a post is short prose, and its words are what a reader searched for.
func Excerpt(body string) string {
	r := []rune(strings.Join(strings.Fields(body), " "))
	if len(r) <= excerptRunes {
		return string(r)
	}
	return string(r[:excerptRunes]) + "…"
}

// title —— a post's name where a title goes: when it was posted.
func title(p *Post) string {
	return "Post of " + p.CreatedAt.UTC().Format("2006-01-02 15:04 UTC")
}
