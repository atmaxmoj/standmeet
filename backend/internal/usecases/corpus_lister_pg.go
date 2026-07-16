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

// allowsNote —— the ONE readability test every visitor-facing corpus surface goes through:
//
//	readable(note) = MatchesAnyCorpusGlob(role_globs, uri)  AND  NOT owner_only
//
// The second term is the note-level owner tier (subjectivity-owner-visibility): a note the vault
// marked `visibility: owner` is unreachable for EVERY visitor session regardless of role globs.
// Pure narrowing — no role and no code can open it — and live (note state, not frozen role state).
//
// ownerOnly is a REQUIRED argument on purpose. The old signature took only (genre, path), so a new
// surface could ACL-check a note without ever considering the owner tier and leak PII silently.
// Making it a parameter means the compiler names every call site: you cannot forget what you must
// pass. (The motivating note is a CV — real name, education, employers — so a silent miss is the
// whole risk.)
func allowsNote(grantedGlobs []string, n noteACL) bool {
	if n.ownerOnly {
		return false
	}
	uri := domain.FormatURI(domain.DocumentGenre(n.genre), n.path)
	return domain.MatchesAnyCorpusGlob(grantedGlobs, uri)
}

// noteACL —— readable() 判定所需的那条笔记的全部事实。用结构体而不是裸 bool 参数：ownerOnly 是
// **这条笔记的属性**（数据），不是调用方的模式开关（control flag）—— 且新增一个 ACL 事实时，
// 每个调用点会被编译器点名，而不是静默沿用默认值放行 PII。
type noteACL struct {
	genre     string
	path      string
	ownerOnly bool
}

// Search —— 词法检索。有 Meili(searcher)走 Meili(corpus_notes:wiki/output/subjectivity = vault)
// + glob ACL,再拼 writings(留在 Postgres 全文,自成一 genre,总是最新、无增量索引负担);Meili
// 缺失/出错则整条退 Postgres 全文(降级不断)。两条路 ACL 一致:同一个 allowsCorpusURI 逐条过。
func (l *pgCorpusLister) Search(
	ctx context.Context, ownerID string, grantedGlobs []string, query string,
) ([]CorpusMeta, error) {
	if l.searcher != nil {
		if notes, ok := l.meiliSearch(ctx, ownerID, grantedGlobs, query); ok {
			return append(notes, l.searchWritings(ctx, ownerID, grantedGlobs, query)...), nil
		}
	}
	return l.pgSearch(ctx, ownerID, grantedGlobs, query), nil
}

// meiliSearch —— Meili 候选(corpus_notes)→ glob ACL 过 → CorpusMeta。出错返 (nil,false) 让 caller 降级 PG。
func (l *pgCorpusLister) meiliSearch(
	ctx context.Context, ownerID string, grantedGlobs []string, query string,
) ([]CorpusMeta, bool) {
	docs, err := l.searcher.Search(ctx, ownerID, query)
	if err != nil {
		return []CorpusMeta{}, false
	}
	out := make([]CorpusMeta, 0, len(docs))
	for i := range docs {
		if !allowsNote(
			grantedGlobs,
			noteACL{genre: docs[i].Genre, path: docs[i].Path, ownerOnly: docs[i].OwnerOnly},
		) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: docs[i].ID, Path: docs[i].Path, Title: docs[i].Title,
			Genre: docs[i].Genre, Snippet: summarize(docs[i].Body),
		})
	}
	return out, true
}

// pgSearch —— Postgres 全文降级路径:4 个 genre 聚合,path 现算,glob ACL 逐条过。
func (l *pgCorpusLister) pgSearch(
	ctx context.Context, ownerID string, grantedGlobs []string, query string,
) []CorpusMeta {
	out := make([]CorpusMeta, 0, searchPageLimit)
	out = append(out, l.searchOutputs(ctx, ownerID, grantedGlobs, query)...)
	out = append(out, l.searchWikis(ctx, ownerID, grantedGlobs, query)...)
	out = append(out, l.searchWritings(ctx, ownerID, grantedGlobs, query)...)
	out = append(out, l.searchSubjectivity(ctx, ownerID, grantedGlobs, query)...)
	return out
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
	if perr != nil || !allowsNote(
		globs,
		noteACL{genre: "subjectivity", path: path, ownerOnly: hit.OwnerOnly},
	) {
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
		if perr != nil || !allowsNote(
			globs,
			noteACL{genre: "wiki", path: path, ownerOnly: hits[i].OwnerOnly},
		) {
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
		if perr != nil || !allowsNote(
			globs,
			noteACL{genre: "output", path: path, ownerOnly: hits[i].OwnerOnly},
		) {
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
		// writings have no owner tier (D.2: they exist to be published).
		if !allowsNote(globs, noteACL{genre: "writing", path: p}) {
			continue
		}
		out = append(out, CorpusMeta{
			ID: hits[i].ID(), Path: p, Title: hits[i].Title(),
			Genre: "writing", Snippet: writingRowSummary(&hits[i]),
		})
	}
	return out
}
