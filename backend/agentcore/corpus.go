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
