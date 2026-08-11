// corpus.go —— #154 step 2: the Driver's corpus data ops + the bridge that turns them
// into a usecases.CorpusLister, so a standalone launch can run the REAL retrieval plugin
// against the Driver's corpus (eval = persona corpus) instead of postgres.
//
// ACL lives HERE (the bridge filters the Driver's raw hits by the session's granted
// scope), so a Driver impl is a plain in-memory data source with NO ACL knowledge — the
// same positive-list rule prod's pgCorpusLister applies, in one place.

package agentcore

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// ErrCorpusNotFound —— a Driver's GetCorpus signals "no such path" with this.
var ErrCorpusNotFound = errors.New("agentcore: corpus path not found")

// CorpusHit —— a search/list row from the Driver (public mirror of corpus.Meta).
//
// Published mirrors the entry's own switch. It is part of the row because readability asks
// the entry for the public identity (access.AllowsCorpusEntry) — a Driver that cannot say
// whether a row is published cannot be ACL-checked the way prod is, and this file's whole
// point is that the eval driver and prod share one rule.
type CorpusHit struct {
	ID        string
	Path      string
	Title     string
	Genre     string
	Snippet   string
	Published bool
}

// CorpusDoc —— a full corpus entry from the Driver (read result).
type CorpusDoc struct {
	ID        string
	Path      string
	Title     string
	Genre     string
	Body      string
	Published bool
}

// driverCorpusLister —— usecases.CorpusLister backed by the Driver's corpus ops.
type driverCorpusLister struct {
	driver Driver
}

func (l driverCorpusLister) Search(
	ctx context.Context, _ string, scope access.CorpusScope, query string,
) ([]corpus.Meta, error) {
	hits, err := l.driver.SearchCorpus(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("driver search corpus: %w", err)
	}
	return filterHits(hits, scope), nil
}

func (l driverCorpusLister) List(
	ctx context.Context, _ string, scope access.CorpusScope, parentPath string, page int,
) ([]corpus.Meta, error) {
	hits, err := l.driver.ListCorpus(ctx, parentPath, page)
	if err != nil {
		return nil, fmt.Errorf("driver list corpus: %w", err)
	}
	return filterHits(hits, scope), nil
}

// MapEntries —— every visible wiki node as {path,title}. Enumerate via SearchCorpus("") (the
// Driver's whole-corpus listing) and keep genre=wiki, ACL-filtered; shaping is BuildCorpusMap.
func (l driverCorpusLister) MapEntries(
	ctx context.Context, _ string, scope access.CorpusScope,
) ([]corpus.MapEntry, error) {
	all, err := l.driver.SearchCorpus(ctx, "")
	if err != nil {
		return nil, fmt.Errorf("driver enumerate corpus: %w", err)
	}
	out := make([]corpus.MapEntry, 0, len(all))
	for i := range all {
		if all[i].Genre != "wiki" ||
			!allowsCorpus(scope, all[i].Genre, all[i].Path, all[i].Published) {
			continue
		}
		out = append(out, corpus.MapEntry{Path: all[i].Path, Title: all[i].Title})
	}
	return out, nil
}

// Resolve —— name → matching wiki node(s), same slug rule as prod (pure resolveByName).
func (l driverCorpusLister) Resolve(
	ctx context.Context, ownerID string, scope access.CorpusScope, name string,
) ([]corpus.Meta, error) {
	entries, err := l.MapEntries(ctx, ownerID, scope)
	if err != nil {
		return nil, err
	}
	return corpus.ResolveByName(entries, name), nil
}

func (l driverCorpusLister) Get(
	ctx context.Context, _ string, scope access.CorpusScope, path string,
) (corpus.Entry, error) {
	doc, err := l.driver.GetCorpus(ctx, path)
	if errors.Is(err, ErrCorpusNotFound) {
		return corpus.Entry{}, corpus.ErrCorpusNotFound
	}
	if err != nil {
		return corpus.Entry{}, fmt.Errorf("driver get corpus: %w", err)
	}
	if !allowsCorpus(scope, doc.Genre, path, doc.Published) {
		return corpus.Entry{}, corpus.ErrCorpusDenied
	}
	return corpus.Entry{
		ID: doc.ID, Path: doc.Path, Title: doc.Title, Genre: doc.Genre, Body: doc.Body,
		Published: doc.Published,
	}, nil
}

// Grep —— never-miss 在这一侧同样成立:枚举全量(SearchCorpus("")),逐条 ACL,再拿同一个
// GrepBody 判定。判定那一步跟 prod 是同一个函数,所以 eval 里"找得到"和线上"找得到"是同一件事。
func (l driverCorpusLister) Grep(
	ctx context.Context, _ string, scope access.CorpusScope, req *corpus.GrepRequest,
) ([]corpus.GrepHit, error) {
	re, cerr := corpus.CompileGrep(req)
	if cerr != nil {
		return nil, fmt.Errorf("grep pattern: %w", cerr)
	}
	all, err := l.driver.SearchCorpus(ctx, "") // 空查询 = 枚举全量
	if err != nil {
		return nil, fmt.Errorf("driver enumerate corpus: %w", err)
	}
	out := make([]corpus.GrepHit, 0, len(all))
	for i := range all {
		if hit, ok := l.grepOne(ctx, scope, re, &all[i]); ok {
			out = append(out, hit)
		}
	}
	return out, nil
}

// Links —— 在 eval Driver 语料上算真链图（不靠 prod 的 note_refs 表）：subject 的 [[X]] 出度
// 用 slug/title 解析成条目（Outgoing），全语料反扫谁 [[link]] 指向 subject（Backlinks）。用
// 既有 corpus.ExtractCrossLinks + SlugifyTitle，跟 prod 的 crosslink 解析同源。SearchCorpus("")
// 空查询枚举全量（见 EvalDriver）。ACL 逐条过（同 Get/filterHits）。语料小，线性扫无碍。
func (l driverCorpusLister) Links(
	ctx context.Context, ownerID string, scope access.CorpusScope, path string,
) (corpus.Links, error) {
	subject, err := l.Get(ctx, ownerID, scope, path)
	if err != nil {
		return corpus.Links{}, err
	}
	all, serr := l.driver.SearchCorpus(ctx, "") // 空查询 = 枚举全量
	if serr != nil {
		return corpus.Links{}, fmt.Errorf("driver enumerate corpus: %w", serr)
	}
	return corpus.Links{
		Outgoing:  outgoingLinks(subject.Body, all, scope),
		Backlinks: l.backlinks(ctx, path, subject.Title, all, scope),
	}, nil
}

// outgoingLinks —— subject body 里的 [[X]] 解析成语料条目（slug 或 title 命中，ACL 过、去重）。
func outgoingLinks(
	body string, all []CorpusHit, scope access.CorpusScope,
) []corpus.Meta {
	out := make([]corpus.Meta, 0)
	seen := map[string]bool{}
	for _, ref := range corpus.ExtractCrossLinks(body) {
		hit, ok := resolveRef(ref.Target, all)
		if !ok || seen[hit.Path] ||
			!allowsCorpus(scope, hit.Genre, hit.Path, hit.Published) {
			continue
		}
		seen[hit.Path] = true
		out = append(out, hitToMeta(hit))
	}
	return out
}

// backlinks —— 反扫全语料：谁的 body [[link]] 指向 subject（按 subject 的 slug/title），谁是 backlink。
func (l driverCorpusLister) backlinks(
	ctx context.Context, subjectPath, subjectTitle string,
	all []CorpusHit, scope access.CorpusScope,
) []corpus.Meta {
	targets := map[string]bool{
		lastSegment(subjectPath): true, corpus.SlugifyTitle(subjectTitle): true,
	}
	out := make([]corpus.Meta, 0)
	for i := range all {
		if l.entryLinksTo(ctx, &all[i], subjectPath, targets, scope) {
			out = append(out, hitToMeta(&all[i]))
		}
	}
	return out
}

// entryLinksTo —— 一条语料 entry 是否 [[link]] 指向 subject（跳过 subject 自己 + ACL 拒的）。
func (l driverCorpusLister) entryLinksTo(
	ctx context.Context, e *CorpusHit, subjectPath string,
	targets map[string]bool, scope access.CorpusScope,
) bool {
	if e.Path == subjectPath || !allowsCorpus(scope, e.Genre, e.Path, e.Published) {
		return false
	}
	doc, derr := l.driver.GetCorpus(ctx, e.Path)
	if derr != nil {
		return false
	}
	return bodyLinksTo(doc.Body, targets)
}

// resolveRef —— 把一个 [[X]] target 解析成语料条目：slug（末段 path）或 title-slug 命中。
func resolveRef(target string, all []CorpusHit) (*CorpusHit, bool) {
	slug := corpus.SlugifyTitle(target)
	for i := range all {
		if lastSegment(all[i].Path) == slug || corpus.SlugifyTitle(all[i].Title) == slug {
			return &all[i], true
		}
	}
	return nil, false
}

func bodyLinksTo(body string, targets map[string]bool) bool {
	for _, ref := range corpus.ExtractCrossLinks(body) {
		if targets[corpus.SlugifyTitle(ref.Target)] {
			return true
		}
	}
	return false
}

func lastSegment(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}

func hitToMeta(h *CorpusHit) corpus.Meta {
	return corpus.Meta{
		ID: h.ID, Path: h.Path, Title: h.Title, Genre: h.Genre, Snippet: h.Snippet,
	}
}

// grepOne —— 一条枚举结果:过 ACL、取正文、判定。正文取不到 → 不命中(eval 语料里那是
// 一条刚被删掉的条目)。
func (l driverCorpusLister) grepOne(
	ctx context.Context, scope access.CorpusScope, re *regexp.Regexp, hit *CorpusHit,
) (corpus.GrepHit, bool) {
	if !allowsCorpus(scope, hit.Genre, hit.Path, hit.Published) {
		return corpus.GrepHit{}, false
	}
	doc, err := l.driver.GetCorpus(ctx, hit.Path)
	if err != nil {
		return corpus.GrepHit{}, false
	}
	lines, total := corpus.GrepBody(re, doc.Body)
	if total == 0 {
		return corpus.GrepHit{}, false
	}
	return corpus.GrepHit{
		Path: hit.Path, Title: hit.Title, Genre: hit.Genre, Total: total, Lines: lines,
	}, true
}

func filterHits(hits []CorpusHit, scope access.CorpusScope) []corpus.Meta {
	out := make([]corpus.Meta, 0, len(hits))
	for i := range hits {
		if !allowsCorpus(scope, hits[i].Genre, hits[i].Path, hits[i].Published) {
			continue
		}
		out = append(out, corpus.Meta{
			ID: hits[i].ID, Path: hits[i].Path, Title: hits[i].Title,
			Genre: hits[i].Genre, Snippet: hits[i].Snippet,
		})
	}
	return out
}

// allowsCorpus —— same readability rule as the prod facade: the identity's reach AND NOT the
// code's narrowing. Routed through the one domain function so the eval driver and prod can
// never diverge — including the published half, which is the whole answer for a public visitor.
func allowsCorpus(scope access.CorpusScope, genre, path string, published bool) bool {
	uri := corpus.FormatURI(corpus.DocumentGenre(genre), path)
	return access.AllowsCorpusEntry(scope, access.CorpusEntryRef{URI: uri, Published: published})
}
