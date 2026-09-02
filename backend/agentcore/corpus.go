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

// Grep — the never-miss guarantee holds here too: enumerate everything
// (SearchCorpus("")), ACL each one, then judge with the same GrepBody. That
// judging step is the same function as prod, so "findable" in eval and
// "findable" in production are the same thing.
func (l driverCorpusLister) Grep(
	ctx context.Context, _ string, scope access.CorpusScope, req *corpus.GrepRequest,
) ([]corpus.GrepHit, error) {
	re, cerr := corpus.CompileGrep(req)
	if cerr != nil {
		return nil, fmt.Errorf("grep pattern: %w", cerr)
	}
	all, err := l.driver.SearchCorpus(ctx, "") // empty query = enumerate everything
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

// Links — computes a real link graph over the eval Driver's corpus (not backed
// by prod's note_refs table): the subject's [[X]] out-edges resolve to entries by
// slug/title (Outgoing); a full-corpus reverse scan finds whose [[link]] points at
// the subject (Backlinks). Uses the existing corpus.ExtractCrossLinks +
// SlugifyTitle, sharing the same crosslink-parsing source as prod. SearchCorpus("")
// with an empty query enumerates everything (see EvalDriver). ACL is checked per
// entry (same as Get/filterHits). The corpus is small, so a linear scan is fine.
func (l driverCorpusLister) Links(
	ctx context.Context, ownerID string, scope access.CorpusScope, path string,
) (corpus.Links, error) {
	subject, err := l.Get(ctx, ownerID, scope, path)
	if err != nil {
		return corpus.Links{}, err
	}
	all, serr := l.driver.SearchCorpus(ctx, "") // empty query = enumerate everything
	if serr != nil {
		return corpus.Links{}, fmt.Errorf("driver enumerate corpus: %w", serr)
	}
	return corpus.Links{
		Outgoing:  outgoingLinks(subject.Body, all, scope),
		Backlinks: l.backlinks(ctx, path, subject.Title, all, scope),
	}, nil
}

// outgoingLinks — resolves the [[X]] refs in the subject body into corpus
// entries (matched by slug or title, ACL-checked, deduped).
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

// backlinks — reverse-scans the whole corpus: whoever's body has a [[link]]
// pointing at the subject (matched by the subject's slug/title) is a backlink.
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

// entryLinksTo — whether one corpus entry [[link]]s to the subject (skips the
// subject itself + anything ACL denies).
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

// resolveRef — resolves one [[X]] target into a corpus entry: matched by
// slug (the path's last segment) or by title-slug.
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

// grepOne — one enumerated result: pass through ACL, fetch the body, judge it.
// Body fetch fails → no match (in the eval corpus that means the entry was just
// deleted).
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
