// corpus.go —— #154 step 2: the Driver's corpus data ops + the bridge that turns them
// into a usecases.CorpusLister, so a standalone launch can run the REAL retrieval plugin
// against the Driver's corpus (eval = persona corpus) instead of postgres.
//
// ACL lives HERE (the bridge filters the Driver's raw hits by the session's granted
// globs), so a Driver impl is a plain in-memory data source with NO ACL knowledge — the
// same positive-list rule prod's pgCorpusLister applies, in one place.

package agentcore

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// ErrCorpusNotFound —— a Driver's GetCorpus signals "no such path" with this.
var ErrCorpusNotFound = errors.New("agentcore: corpus path not found")

// CorpusHit —— a search/list row from the Driver (public mirror of usecases.CorpusMeta).
type CorpusHit struct {
	ID      string
	Path    string
	Title   string
	Genre   string
	Snippet string
}

// CorpusDoc —— a full corpus entry from the Driver (read result).
type CorpusDoc struct {
	ID    string
	Path  string
	Title string
	Genre string
	Body  string
}

// driverCorpusLister —— usecases.CorpusLister backed by the Driver's corpus ops.
type driverCorpusLister struct {
	driver Driver
}

func (l driverCorpusLister) Search(
	ctx context.Context, _ string, grantedGlobs []string, query string,
) ([]usecases.CorpusMeta, error) {
	hits, err := l.driver.SearchCorpus(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("driver search corpus: %w", err)
	}
	return filterHits(hits, grantedGlobs), nil
}

func (l driverCorpusLister) List(
	ctx context.Context, _ string, grantedGlobs []string, parentPath string, page int,
) ([]usecases.CorpusMeta, error) {
	hits, err := l.driver.ListCorpus(ctx, parentPath, page)
	if err != nil {
		return nil, fmt.Errorf("driver list corpus: %w", err)
	}
	return filterHits(hits, grantedGlobs), nil
}

// MapEntries —— every visible wiki node as {path,title}. Enumerate via SearchCorpus("") (the
// Driver's whole-corpus listing) and keep genre=wiki, ACL-filtered; shaping is BuildCorpusMap.
func (l driverCorpusLister) MapEntries(
	ctx context.Context, _ string, grantedGlobs []string,
) ([]usecases.CorpusMapEntry, error) {
	all, err := l.driver.SearchCorpus(ctx, "")
	if err != nil {
		return nil, fmt.Errorf("driver enumerate corpus: %w", err)
	}
	out := make([]usecases.CorpusMapEntry, 0, len(all))
	for i := range all {
		if all[i].Genre != "wiki" || !allowsCorpus(grantedGlobs, all[i].Genre, all[i].Path) {
			continue
		}
		out = append(out, usecases.CorpusMapEntry{Path: all[i].Path, Title: all[i].Title})
	}
	return out, nil
}

// Resolve —— name → matching wiki node(s), same slug rule as prod (pure resolveByName).
func (l driverCorpusLister) Resolve(
	ctx context.Context, ownerID string, grantedGlobs []string, name string,
) ([]usecases.CorpusMeta, error) {
	entries, err := l.MapEntries(ctx, ownerID, grantedGlobs)
	if err != nil {
		return nil, err
	}
	return usecases.ResolveByName(entries, name), nil
}

func (l driverCorpusLister) Get(
	ctx context.Context, _ string, grantedGlobs []string, path string,
) (usecases.CorpusEntry, error) {
	doc, err := l.driver.GetCorpus(ctx, path)
	if errors.Is(err, ErrCorpusNotFound) {
		return usecases.CorpusEntry{}, usecases.ErrCorpusNotFound
	}
	if err != nil {
		return usecases.CorpusEntry{}, fmt.Errorf("driver get corpus: %w", err)
	}
	if !allowsCorpus(grantedGlobs, doc.Genre, path) {
		return usecases.CorpusEntry{}, usecases.ErrCorpusDenied
	}
	return usecases.CorpusEntry{
		ID: doc.ID, Path: doc.Path, Title: doc.Title, Genre: doc.Genre, Body: doc.Body,
	}, nil
}

// Links —— 在 eval Driver 语料上算真链图（不靠 prod 的 note_refs 表）：subject 的 [[X]] 出度
// 用 slug/title 解析成条目（Outgoing），全语料反扫谁 [[link]] 指向 subject（Backlinks）。用
// 既有 usecases.ExtractCrossLinks + SlugifyTitle，跟 prod 的 crosslink 解析同源。SearchCorpus("")
// 空查询枚举全量（见 EvalDriver）。ACL 逐条过（同 Get/filterHits）。语料小，线性扫无碍。
func (l driverCorpusLister) Links(
	ctx context.Context, ownerID string, grantedGlobs []string, path string,
) (usecases.CorpusLinks, error) {
	subject, err := l.Get(ctx, ownerID, grantedGlobs, path)
	if err != nil {
		return usecases.CorpusLinks{}, err
	}
	all, serr := l.driver.SearchCorpus(ctx, "") // 空查询 = 枚举全量
	if serr != nil {
		return usecases.CorpusLinks{}, fmt.Errorf("driver enumerate corpus: %w", serr)
	}
	return usecases.CorpusLinks{
		Outgoing:  outgoingLinks(subject.Body, all, grantedGlobs),
		Backlinks: l.backlinks(ctx, path, subject.Title, all, grantedGlobs),
	}, nil
}

// outgoingLinks —— subject body 里的 [[X]] 解析成语料条目（slug 或 title 命中，ACL 过、去重）。
func outgoingLinks(
	body string, all []CorpusHit, globs []string,
) []usecases.CorpusMeta {
	out := make([]usecases.CorpusMeta, 0)
	seen := map[string]bool{}
	for _, ref := range usecases.ExtractCrossLinks(body) {
		hit, ok := resolveRef(ref.Target, all)
		if !ok || seen[hit.Path] || !allowsCorpus(globs, hit.Genre, hit.Path) {
			continue
		}
		seen[hit.Path] = true
		out = append(out, hitToMeta(hit))
	}
	return out
}

// backlinks —— 反扫全语料：谁的 body [[link]] 指向 subject（按 subject 的 slug/title），谁是 backlink。
func (l driverCorpusLister) backlinks(
	ctx context.Context, subjectPath, subjectTitle string, all []CorpusHit, globs []string,
) []usecases.CorpusMeta {
	targets := map[string]bool{
		lastSegment(subjectPath): true, usecases.SlugifyTitle(subjectTitle): true,
	}
	out := make([]usecases.CorpusMeta, 0)
	for i := range all {
		if l.entryLinksTo(ctx, &all[i], subjectPath, targets, globs) {
			out = append(out, hitToMeta(&all[i]))
		}
	}
	return out
}

// entryLinksTo —— 一条语料 entry 是否 [[link]] 指向 subject（跳过 subject 自己 + ACL 拒的）。
func (l driverCorpusLister) entryLinksTo(
	ctx context.Context, e *CorpusHit, subjectPath string, targets map[string]bool, globs []string,
) bool {
	if e.Path == subjectPath || !allowsCorpus(globs, e.Genre, e.Path) {
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
	slug := usecases.SlugifyTitle(target)
	for i := range all {
		if lastSegment(all[i].Path) == slug || usecases.SlugifyTitle(all[i].Title) == slug {
			return &all[i], true
		}
	}
	return nil, false
}

func bodyLinksTo(body string, targets map[string]bool) bool {
	for _, ref := range usecases.ExtractCrossLinks(body) {
		if targets[usecases.SlugifyTitle(ref.Target)] {
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

func hitToMeta(h *CorpusHit) usecases.CorpusMeta {
	return usecases.CorpusMeta{
		ID: h.ID, Path: h.Path, Title: h.Title, Genre: h.Genre, Snippet: h.Snippet,
	}
}

func filterHits(hits []CorpusHit, globs []string) []usecases.CorpusMeta {
	out := make([]usecases.CorpusMeta, 0, len(hits))
	for i := range hits {
		if !allowsCorpus(globs, hits[i].Genre, hits[i].Path) {
			continue
		}
		out = append(out, usecases.CorpusMeta{
			ID: hits[i].ID, Path: hits[i].Path, Title: hits[i].Title,
			Genre: hits[i].Genre, Snippet: hits[i].Snippet,
		})
	}
	return out
}

func allowsCorpus(globs []string, genre, path string) bool {
	return domain.MatchesAnyCorpusGlob(globs, domain.FormatURI(domain.DocumentGenre(genre), path))
}
