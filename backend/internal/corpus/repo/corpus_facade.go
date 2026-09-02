// corpus_facade.go — Corpus: the unified cross-genre access entry point.
//
// Wraps the 4 repos Raw / Wiki / Output / WritingRepo behind one facade,
// addressed externally by URI / genre. Collection operations return []Document
// (type-erased), so the caller no longer writes genre-symmetric code by hand.
//
// The type itself is named Corpus (no Repo suffix) — it stands for the corpus
// collection itself. `Get(uri)` reads naturally at the call site, less noisy
// than `corpusRepo.Get`.
//
// **Not wired into the retriever during phase A.2** (existing retriever / route
// calls stay unchanged) — this only stands up the facade skeleton. A.3-IAM
// switches the retriever's core to Document/Corpus together with URI ACL.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Corpus — the unified corpus access entry point.
type Corpus struct {
	raw      *RawRepo
	wiki     *WikiRepo
	output   *OutputRepo
	writings *WritingRepo
}

// NewCorpus — constructs the facade. The caller (composition root) supplies the 4 repos.
func NewCorpus(
	raw *RawRepo, wiki *WikiRepo, output *OutputRepo, writings *WritingRepo,
) *Corpus {
	return &Corpus{raw: raw, wiki: wiki, output: output, writings: writings}
}

// ErrCorpusGenreNotSupported — the URI scheme parsed to a shape outside the 4 genres.
// Usually means the caller mistyped the URI, or a new genre was added without extending
// the facade's dispatch.
var ErrCorpusGenreNotSupported = errors.New("corpus genre not supported")

// Get — fetches one document by URI. Dispatch by genre.
//
// URI shapes (see ParseURI):
//   - raw://<uuid>        → RawRepo.GetByID(ownerID, uuid)
//   - wiki://<path>       → WikiRepo looks up the entry with a matching path;
//     falls back to wiki://<id>
//   - output://<path>     → same logic as wiki
//   - writing://<slug>    → WritingRepo.GetBySlug(ownerID, slug)
//
// **Note**: ownerID is required here because every corpus table is owner-scoped; the URI
// itself carries no owner (pre-launch this is a single-owner instance, and even after
// multi-tenant the URI still won't carry one — owner scope comes from the visitor session).
func (c *Corpus) Get(ctx context.Context, ownerID, uri string) (entity.Document, error) {
	ref, perr := entity.ParseURI(uri)
	if perr != nil {
		return nil, fmt.Errorf("parse uri: %w", perr)
	}
	getter, ok := c.getterFor(ref.Genre)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrCorpusGenreNotSupported, ref.Genre)
	}
	return getter(ctx, ownerID, ref.Path)
}

// genreGetter — flattens dispatch-by-genre into a map to stay under Get's switch-statement
// cyclomatic ceiling. Each value is a closure wrapping the matching repo in a uniform signature.
type genreGetter func(ctx context.Context, ownerID, idOrPath string) (entity.Document, error)

// List — lists an owner's documents, filtered to the given genres. Empty genres → all 4.
// Returns []Document type-erased; the caller learns each entry's origin via Document.Genre().
//
// During phase A.2, List goes through the repos' existing ListByOwner; this is where to add
// limit/cursor support later. **Not wired into retriever / route** — that's A.3-IAM.
func (c *Corpus) List(
	ctx context.Context, ownerID string, genres []entity.DocumentGenre,
) ([]entity.Document, error) {
	want := genreSet(genres)
	out := []entity.Document{}
	if err := c.appendRawIfWanted(ctx, ownerID, want, &out); err != nil {
		return []entity.Document{}, err
	}
	if err := c.appendWikiIfWanted(ctx, ownerID, want, &out); err != nil {
		return []entity.Document{}, err
	}
	if err := c.appendOutputIfWanted(ctx, ownerID, want, &out); err != nil {
		return []entity.Document{}, err
	}
	if err := c.appendWritingsIfWanted(ctx, ownerID, want, &out); err != nil {
		return []entity.Document{}, err
	}
	return out, nil
}

// genreSet — an empty genres list means "everything"; otherwise filters exactly to the list.
func genreSet(genres []entity.DocumentGenre) map[entity.DocumentGenre]struct{} {
	if len(genres) == 0 {
		out := make(map[entity.DocumentGenre]struct{}, len(entity.AllGenres))
		for _, g := range entity.AllGenres {
			out[g] = struct{}{}
		}
		return out
	}
	out := make(map[entity.DocumentGenre]struct{}, len(genres))
	for _, g := range genres {
		out[g] = struct{}{}
	}
	return out
}

// listLimitDefault — the limit Corpus.List passes to the underlying repos; fixed at 1000
// for phase A.2, well above pre-launch data volume. Replaced by cursor pagination from
// A.3 onward.
const listLimitDefault = 1000

func (c *Corpus) appendRawIfWanted(
	ctx context.Context, ownerID string, want map[entity.DocumentGenre]struct{},
	out *[]entity.Document,
) error {
	if _, ok := want[entity.GenreRaw]; !ok {
		return nil
	}
	rows, err := c.raw.ListByOwner(ctx, ownerID, listLimitDefault)
	if err != nil {
		return fmt.Errorf("list raw: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

func (c *Corpus) appendWikiIfWanted(
	ctx context.Context, ownerID string, want map[entity.DocumentGenre]struct{},
	out *[]entity.Document,
) error {
	if _, ok := want[entity.GenreWiki]; !ok {
		return nil
	}
	rows, err := c.wiki.ListByOwner(ctx, ownerID, listLimitDefault)
	if err != nil {
		return fmt.Errorf("list wiki: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

func (c *Corpus) appendOutputIfWanted(
	ctx context.Context, ownerID string, want map[entity.DocumentGenre]struct{},
	out *[]entity.Document,
) error {
	if _, ok := want[entity.GenreOutput]; !ok {
		return nil
	}
	rows, err := c.output.ListByOwner(ctx, ownerID, listLimitDefault)
	if err != nil {
		return fmt.Errorf("list output: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

func (c *Corpus) appendWritingsIfWanted(
	ctx context.Context, ownerID string, want map[entity.DocumentGenre]struct{},
	out *[]entity.Document,
) error {
	if _, ok := want[entity.GenreWriting]; !ok {
		return nil
	}
	rows, err := c.writings.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("list writings: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

// ─── per-genre Get dispatchers ──────────────────────────────────────

// getterFor — the dispatch entry for Get. Returns (genreGetter, true), or (nil, false) when
// unrecognized. Switch length = len(AllGenres); adding a genre means extending the case here.
func (c *Corpus) getterFor(g entity.DocumentGenre) (genreGetter, bool) {
	// A map lookup instead of a switch: cyclo=1, and adding a genre only needs one more
	// map entry. subjectivity is intentionally absent (a private tier that goes through its
	// own SubjectivityCiteLookup); a miss here → (nil, false).
	getter, ok := map[entity.DocumentGenre]genreGetter{
		entity.GenreRaw:     c.getRaw,
		entity.GenreWiki:    c.getWiki,
		entity.GenreOutput:  c.getOutput,
		entity.GenreWriting: c.getWriting,
	}[g]
	return getter, ok
}

func (c *Corpus) getRaw(
	ctx context.Context, ownerID, idOrPath string,
) (entity.Document, error) {
	r, err := c.raw.GetByID(ctx, ownerID, idOrPath)
	if err != nil {
		return nil, fmt.Errorf("corpus get raw: %w", err)
	}
	return &r, nil
}

// getWiki / getOutput — fetch by id. The address is tree-derived and unstable, so citing /
// addressing always goes through wiki://<id> / output://<id> (see domain.URI), which means
// ref is always a uuid.
func (c *Corpus) getWiki(
	ctx context.Context, ownerID, id string,
) (entity.Document, error) {
	w, err := c.wiki.GetByID(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("corpus get wiki: %w", err)
	}
	return &w, nil
}

func (c *Corpus) getOutput(
	ctx context.Context, ownerID, id string,
) (entity.Document, error) {
	o, err := c.output.GetByID(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("corpus get output: %w", err)
	}
	return &o, nil
}

// getWriting — a writing's canonical address is writing://<slug> (how the public reader
// addresses it), but a dialog's cited references persist / look up by uuid
// (cited_writing_ids is a uuid[], matching wiki/output). So uuid → GetByID,
// slug → GetBySlug; a slug is never a valid uuid, so the two paths never collide.
func (c *Corpus) getWriting(
	ctx context.Context, ownerID, idOrSlug string,
) (entity.Document, error) {
	w, err := c.getWritingRow(ctx, ownerID, idOrSlug)
	if err != nil {
		return nil, fmt.Errorf("corpus get writing: %w", err)
	}
	return &w, nil
}

func (c *Corpus) getWritingRow(
	ctx context.Context, ownerID, idOrSlug string,
) (entity.Writing, error) {
	if pgstore.IsUUID(idOrSlug) {
		return c.writings.GetByID(ctx, ownerID, idOrSlug)
	}
	return c.writings.GetBySlug(ctx, ownerID, idOrSlug)
}
