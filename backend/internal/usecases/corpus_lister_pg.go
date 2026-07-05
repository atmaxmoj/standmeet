// corpus_lister_pg.go —— the postgres-backed CorpusLister (#157). Composes the 3 genre
// repos and owns path computation + ACL, so the retriever (and the eval) see only the
// slim 3-method port. This is the old retriever's search/read/list engine MINUS the
// in-memory windows + seen-cache: every lookup is DB, path resolves fresh, and ACL is
// applied INSIDE each method against the granted globs (not by the caller afterwards).
//
// The genre repos (WikiLister/OutputLister/WritingLister) survive only as this impl's
// private sub-ports — GetMetaByID etc. are now internal path-walk plumbing, never seen
// by a consumer. Construct inline (&pgCorpusLister{...}); no constructor (ireturn).

package usecases

import (
	"context"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// ErrCorpusNotFound / ErrCorpusDenied —— Get's two failure modes, separated so the wire
// can keep the old dispatchRead distinction ("not found" vs "access denied").
var (
	ErrCorpusNotFound = errors.New("corpus: not found")
	ErrCorpusDenied   = errors.New("corpus: access denied")
)

// pgCorpusLister —— CorpusLister over the genre repos.
type pgCorpusLister struct {
	wiki         WikiLister
	output       OutputLister
	writing      WritingLister
	subjectivity *postgres.NoteRepo
}

// allowsCorpusURI —— shared ACL test: does any granted glob match genre://path?
func allowsCorpusURI(grantedGlobs []string, genre, path string) bool {
	uri := domain.FormatURI(domain.DocumentGenre(genre), path)
	return domain.MatchesAnyCorpusGlob(grantedGlobs, uri)
}

// Search —— DB full-text across output+wiki+writing (first page), path computed per hit,
// filtered to grantedGlobs. Genre order (output, wiki, writing) from collectMatchingEntries.
func (l *pgCorpusLister) Search(
	ctx context.Context, ownerID string, grantedGlobs []string, query string,
) ([]CorpusMeta, error) {
	out := make([]CorpusMeta, 0, searchPageLimit)
	out = append(out, l.searchOutputs(ctx, ownerID, grantedGlobs, query)...)
	out = append(out, l.searchWikis(ctx, ownerID, grantedGlobs, query)...)
	out = append(out, l.searchWritings(ctx, ownerID, grantedGlobs, query)...)
	out = append(out, l.searchSubjectivity(ctx, ownerID, grantedGlobs, query)...)
	return out, nil
}

func (l *pgCorpusLister) searchSubjectivity(
	ctx context.Context, ownerID string, globs []string, q string,
) []CorpusMeta {
	if l.subjectivity == nil {
		return []CorpusMeta{}
	}
	hits, err := l.subjectivity.Search(ctx, ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(hits))
	for i := range hits {
		if m, ok := l.subjectivityHit(ctx, ownerID, globs, &hits[i]); ok {
			out = append(out, m)
		}
	}
	return out
}

func (l *pgCorpusLister) subjectivityHit(
	ctx context.Context, ownerID string, globs []string, hit *postgres.NoteMeta,
) (CorpusMeta, bool) {
	path, perr := deriveNotePath(ctx, l.subjectivity, ownerID, hit.ID)
	if perr != nil || !allowsCorpusURI(globs, "subjectivity", path) {
		return CorpusMeta{}, false
	}
	return CorpusMeta{
		ID: hit.ID, Path: path, Title: hit.Title,
		Genre: "subjectivity", Snippet: summarize(hit.Snippet),
	}, true
}

func (l *pgCorpusLister) searchWikis(
	ctx context.Context, ownerID string, globs []string, q string,
) []CorpusMeta {
	hits, err := l.wiki.Search(ctx, ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(hits))
	for i := range hits {
		path, perr := wikiPathByID(ctx, l.wiki, ownerID, hits[i].ID)
		if perr != nil || !allowsCorpusURI(globs, "wiki", path) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: hits[i].ID, Path: path, Title: hits[i].Title,
			Genre: "wiki", Snippet: summarize(hits[i].Snippet),
		})
	}
	return out
}

func (l *pgCorpusLister) searchOutputs(
	ctx context.Context, ownerID string, globs []string, q string,
) []CorpusMeta {
	hits, err := l.output.Search(ctx, ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(hits))
	for i := range hits {
		path, perr := outputPathByID(ctx, l.output, ownerID, hits[i].ID)
		if perr != nil || !allowsCorpusURI(globs, "output", path) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: hits[i].ID, Path: path, Title: hits[i].Title,
			Genre: "output", Snippet: summarize(hits[i].Snippet),
		})
	}
	return out
}

func (l *pgCorpusLister) searchWritings(
	ctx context.Context, ownerID string, globs []string, q string,
) []CorpusMeta {
	hits, err := l.writing.Search(ctx, ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(hits))
	for i := range hits {
		p := hits[i].Path()
		if !allowsCorpusURI(globs, "writing", p) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: hits[i].ID(), Path: p, Title: hits[i].Title(),
			Genre: "writing", Snippet: writingRowSummary(&hits[i]),
		})
	}
	return out
}
