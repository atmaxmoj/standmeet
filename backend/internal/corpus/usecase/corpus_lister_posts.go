// corpus_lister_posts.go —— posts in a visitor's corpus tools. The lister never decides who sees a
// post: it asks PostsReader (implemented by corpus/posts) with the session's role, and gets back
// only what that role may see. A role's corpus globs and a code's denials play no part — a post's
// audience is the post's own (docs/design/posts.md, "Who reads what").

package usecase

import (
	"context"
	"regexp"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// PostsReader —— the posts a reader with this role may see. roleID "" = no role (public).
type PostsReader interface {
	Search(ctx context.Context, ownerID, roleID, query string) []Meta
	List(ctx context.Context, ownerID, roleID string, page int) []Meta
	// Get —— ok=false when the post is missing or the role may not see it: one answer.
	Get(ctx context.Context, ownerID, roleID, id string) (Entry, bool)
	All(ctx context.Context, ownerID, roleID string) []Entry
}

// postsDir —— the address the timeline lists under; a post is posts/<id> (or post://<id>).
const postsDir = "posts"

// PostIDOf —— the post id a tool address names, if it names one.
func PostIDOf(path string) (string, bool) {
	for _, prefix := range []string{postsDir + "/", "post://"} {
		if id, ok := strings.CutPrefix(path, prefix); ok && id != "" {
			return id, true
		}
	}
	return "", false
}

func (l *pgCorpusLister) searchPosts(
	ctx context.Context, ownerID string, scope access.CorpusScope, q string,
) []Meta {
	if l.posts == nil || q == "" {
		return []Meta{}
	}
	return l.posts.Search(ctx, ownerID, scope.RoleID, q)
}

// postsRoot —— the timeline's one root entry, shown only when the reader can see a post in it.
func (l *pgCorpusLister) postsRoot(
	ctx context.Context, ownerID string, scope access.CorpusScope,
) []Meta {
	if l.posts == nil || len(l.posts.List(ctx, ownerID, scope.RoleID, 0)) == 0 {
		return []Meta{}
	}
	return []Meta{{
		Path: postsDir, Title: "Posts — short updates, newest first", Genre: "post",
		HasChildren: true,
	}}
}

func (l *pgCorpusLister) listPosts(
	ctx context.Context, ownerID string, scope access.CorpusScope, page int,
) []Meta {
	if l.posts == nil {
		return []Meta{}
	}
	return l.posts.List(ctx, ownerID, scope.RoleID, page)
}

func (l *pgCorpusLister) getPost(
	ctx context.Context, ownerID string, scope access.CorpusScope, id string,
) (Entry, error) {
	if l.posts == nil {
		return Entry{}, ErrCorpusNotFound
	}
	e, ok := l.posts.Get(ctx, ownerID, scope.RoleID, id)
	if !ok {
		return Entry{}, ErrCorpusNotFound
	}
	return e, nil
}

func (l *pgCorpusLister) grepPosts(
	ctx context.Context, ownerID string, scope access.CorpusScope, re *regexp.Regexp,
) []GrepHit {
	if l.posts == nil {
		return []GrepHit{}
	}
	all := l.posts.All(ctx, ownerID, scope.RoleID)
	out := make([]GrepHit, 0, len(all))
	for i := range all {
		lines, total := GrepBody(re, all[i].Body)
		if total == 0 {
			continue
		}
		out = append(out, GrepHit{
			Path: all[i].Path, Title: all[i].Title, Genre: all[i].Genre, Total: total, Lines: lines,
		})
	}
	return out
}
