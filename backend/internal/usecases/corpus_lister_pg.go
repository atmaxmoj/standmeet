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

	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/search"
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
	queryRepo    *postgres.VaultSyncRepo // standmeet-query 跨-genre 过滤 + corpus_links 取邻居 genre/path
	noteRefs     *postgres.NoteRefRepo   // corpus_links 顺 note_refs 取 outgoing/backlinks 邻居
	searcher     *search.Client          // Meili 词法后端;nil(未配)→ Search 退 Postgres 全文
}

// allowsCorpusURI —— shared ACL test: does any granted glob match genre://path?
// allowsCorpusURI —— the ONE readability test every visitor-facing corpus surface goes through:
// the role's grant AND NOT this code's narrowing (domain.AllowsCorpusScope). Taking the whole
// SCOPE (not a bare grant list) is the point: a facade handed only the grant would serve exactly
// what the owner took back on that code — a fail-open the type system now prevents.
func allowsCorpusURI(scope domain.CorpusScope, genre, path string) bool {
	uri := corpusdomain.FormatURI(corpusdomain.DocumentGenre(genre), path)
	return domain.AllowsCorpusScope(scope, uri)
}

// Search —— 词法检索。有 Meili(searcher)走 Meili(corpus_notes:wiki/output/subjectivity = vault)
// + glob ACL,再拼 writings(留在 Postgres 全文,自成一 genre,总是最新、无增量索引负担);Meili
// 缺失/出错则整条退 Postgres 全文(降级不断)。两条路 ACL 一致:同一个 allowsCorpusURI 逐条过。
func (l *pgCorpusLister) Search(
	ctx context.Context, ownerID string, scope domain.CorpusScope, query string,
) ([]CorpusMeta, error) {
	if l.searcher != nil {
		if notes, ok := l.meiliSearch(ctx, ownerID, scope, query); ok {
			return append(notes, l.searchWritings(ctx, ownerID, scope, query)...), nil
		}
	}
	return l.pgSearch(ctx, ownerID, scope, query), nil
}

// meiliSearch —— Meili 候选(corpus_notes)→ glob ACL 过 → CorpusMeta。出错返 (nil,false) 让 caller 降级 PG。
func (l *pgCorpusLister) meiliSearch(
	ctx context.Context, ownerID string, scope domain.CorpusScope, query string,
) ([]CorpusMeta, bool) {
	docs, err := l.searcher.Search(ctx, ownerID, query)
	if err != nil {
		return []CorpusMeta{}, false
	}
	out := make([]CorpusMeta, 0, len(docs))
	for i := range docs {
		if !allowsCorpusURI(scope, docs[i].Genre, docs[i].Path) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: docs[i].ID, Path: docs[i].Path, Title: docs[i].Title,
			Genre: docs[i].Genre, Snippet: snippet(docs[i].Body),
		})
	}
	return out, true
}

// pgSearch —— Postgres 全文降级路径:4 个 genre 聚合,path 现算,glob ACL 逐条过。
func (l *pgCorpusLister) pgSearch(
	ctx context.Context, ownerID string, scope domain.CorpusScope, query string,
) []CorpusMeta {
	out := make([]CorpusMeta, 0, searchPageLimit)
	out = append(out, l.searchOutputs(ctx, ownerID, scope, query)...)
	out = append(out, l.searchWikis(ctx, ownerID, scope, query)...)
	out = append(out, l.searchWritings(ctx, ownerID, scope, query)...)
	out = append(out, l.searchSubjectivity(ctx, ownerID, scope, query)...)
	return out
}

func (l *pgCorpusLister) searchSubjectivity(
	ctx context.Context, ownerID string, scope domain.CorpusScope, q string,
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
		if m, ok := l.subjectivityHit(ctx, ownerID, scope, &hits[i]); ok {
			out = append(out, m)
		}
	}
	return out
}

func (l *pgCorpusLister) subjectivityHit(
	ctx context.Context, ownerID string, scope domain.CorpusScope, hit *postgres.NoteMeta,
) (CorpusMeta, bool) {
	path, perr := deriveNotePath(ctx, l.subjectivity, ownerID, hit.ID)
	if perr != nil || !allowsCorpusURI(scope, "subjectivity", path) {
		return CorpusMeta{}, false
	}
	return CorpusMeta{
		ID: hit.ID, Path: path, Title: hit.Title,
		Genre: "subjectivity", Snippet: snippet(hit.Snippet),
	}, true
}

func (l *pgCorpusLister) searchWikis(
	ctx context.Context, ownerID string, scope domain.CorpusScope, q string,
) []CorpusMeta {
	hits, err := l.wiki.Search(ctx, ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(hits))
	for i := range hits {
		path, perr := wikiPathByID(ctx, l.wiki, ownerID, hits[i].ID)
		if perr != nil || !allowsCorpusURI(scope, "wiki", path) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: hits[i].ID, Path: path, Title: hits[i].Title,
			Genre: "wiki", Snippet: snippet(hits[i].Snippet),
		})
	}
	return out
}

func (l *pgCorpusLister) searchOutputs(
	ctx context.Context, ownerID string, scope domain.CorpusScope, q string,
) []CorpusMeta {
	hits, err := l.output.Search(ctx, ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(hits))
	for i := range hits {
		path, perr := outputPathByID(ctx, l.output, ownerID, hits[i].ID)
		if perr != nil || !allowsCorpusURI(scope, "output", path) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: hits[i].ID, Path: path, Title: hits[i].Title,
			Genre: "output", Snippet: snippet(hits[i].Snippet),
		})
	}
	return out
}

func (l *pgCorpusLister) searchWritings(
	ctx context.Context, ownerID string, scope domain.CorpusScope, q string,
) []CorpusMeta {
	hits, err := l.writing.Search(ctx, ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []CorpusMeta{}
	}
	out := make([]CorpusMeta, 0, len(hits))
	for i := range hits {
		p := hits[i].Path()
		if !allowsCorpusURI(scope, "writing", p) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: hits[i].ID(), Path: p, Title: hits[i].Title(),
			Genre: "writing", Snippet: writingRowSummary(&hits[i]),
		})
	}
	return out
}
