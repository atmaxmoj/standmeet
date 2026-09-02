// corpus_rows.go — each genre's row → the one unified shape (declared in corpus.go).
//
// Four genres: raw / wiki / output / subjectivity. subjectivity has its own separate
// write entry point (subjectivity_write), but reads, deletes, and attaching media all go
// through the same path as the other three.
//
// The address (path) is **tree-derived**: a listing computes the path table for the whole
// window at once, a detail view computes it for one entry. The owner can't set an address
// directly, so there's no "path field" here — only the one that gets computed.

package ops

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

// rawStatus — this is exactly what the sidebar's "needs sorting" badge counts:
// once promoted, it counts as handled.
func rawStatus(r *entity.Raw) string {
	if r.IsPromoted() {
		return "promoted"
	}
	return "unprocessed"
}

func rawItem(r *entity.Raw, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreRaw, ID: r.ID(), Body: r.Body(),
		Preview: usecase.LeadLine(r.Body(), previewMaxLen),
		Source:  r.Source(), Status: rawStatus(r), FlaggedPrivate: r.FlaggedPrivate(),
		Tags: nonNilStrings(r.Tags()), SourceRawIDs: []string{},
		SourceWikiIDs: []string{},
		CreatedAt:     rfc3339(r.CreatedAt()), UpdatedAt: rfc3339(r.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := r.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

func wikiItem(w *entity.Wiki, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreWiki, ID: w.ID(), Title: w.Title(),
		Preview: usecase.LeadLine(w.Body(), previewMaxLen), Excerpt: w.Excerpt(),
		Tags: nonNilStrings(w.Tags()), SourceRawIDs: nonNilStrings(w.SourceRawIDs()),
		CSSClasses:    nonNilStrings(w.CSSClasses()),
		SourceWikiIDs: []string{},
		ShowAsSource:  w.ShowAsSource(), Published: w.Published(),
		CreatedAt: rfc3339(w.CreatedAt()), UpdatedAt: rfc3339(w.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := w.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

func outputItem(o *entity.Output, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreOutput, ID: o.ID(), Title: o.Title(),
		Preview: usecase.LeadLine(o.Body(), previewMaxLen), Excerpt: o.Excerpt(),
		Tags: nonNilStrings(o.Tags()), SourceRawIDs: []string{},
		SourceWikiIDs: nonNilStrings(o.SourceWikiIDs()),
		ShowAsSource:  o.ShowAsSource(), Published: o.Published(),
		CreatedAt: rfc3339(o.CreatedAt()), UpdatedAt: rfc3339(o.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := o.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

// ── Search hit rows (meta) → the same unified shape ──────────────────────
// Full-text search returns **meta**: a snippet, no full body (searching a few hundred hits
// shouldn't drag the whole body along for each). The client shouldn't need two parsing
// paths for that, so this maps hits into a row identical to the listing shape, just with
// `preview` holding the hit snippet. **An empty field means "this path didn't bring it
// back", not "this note doesn't have one"** — tags/source ids are left as empty arrays;
// fetch corpus.get if you need them (the flip side of [[empty-is-not-json-null]]: don't
// treat "wasn't fetched" as "doesn't exist").

// **Leaving the address (path) empty is deliberate**: search hits are scattered
// individual rows, their ancestor chain doesn't come back with them, and path is
// **derived from the ancestor chain**. Assembling one from what little we have on hand
// would just be making it up. The row's `id` is already enough to open it
// (`corpus.get` / the panel's edit form both key on id).

// metaPreview — a hit snippet goes through **the same cleanup as listings** before
// becoming a preview.
//
// Dropping the raw `ts_headline` output straight into preview means the owner sees
// `> [!i18n] > <label><input type="radio" name="ashby-lang" checked>EN</label>…` in the
// admin panel — that's literally the start of the i18n callout HTML from the real vault
// note's body. **Raw markup leaking in front of the owner** is the classic shape of this
// whole defect family, and I introduced this instance myself when adding search (caught
// live by ⑤ visual inspection). When a snippet is pure structure → LeadLine returns
// empty → the card shows no preview, matching ordinary listing behavior.
func metaPreview(snippet string) string {
	return usecase.SearchSnippet(snippet, previewMaxLen)
}

func wikiMetaItem(m *repo.WikiMeta) corpusItemOut {
	return corpusItemOut{
		Genre: genreWiki, ID: m.ID, Title: m.Title,
		Preview:   metaPreview(m.Snippet),
		ParentID:  m.ParentID,
		Published: m.Published,
		Tags:      []string{}, SourceRawIDs: []string{}, SourceWikiIDs: []string{},
		UpdatedAt: rfc3339OrEmpty(m.UpdatedAt),
	}
}

func outputMetaItem(m *repo.OutputMeta) corpusItemOut {
	return corpusItemOut{
		Genre: genreOutput, ID: m.ID, Title: m.Title,
		Preview:   metaPreview(m.Snippet),
		ParentID:  m.ParentID,
		Published: m.Published,
		Tags:      []string{}, SourceRawIDs: []string{}, SourceWikiIDs: []string{},
		UpdatedAt: rfc3339OrEmpty(m.UpdatedAt),
	}
}

// noteMetaItem — raw and subjectivity go through the same meta shape.
//
// All four genres now carry UpdatedAt (the search query fetches it), and it's **left
// empty** when it can't be fetched. This comment used to say "the search query doesn't
// fetch it, and leaving it empty is more honest than filling in a fake time" — the
// reasoning was right, but at the time it had only been swept through raw/subjectivity,
// and wiki/output kept rendering the zero value as `1970-01-01T00:00:00Z` on the wire
// (F-L-46 / [[lesson-not-swept-to-neighbours]]). Now all four genres share
// `rfc3339OrEmpty`, so that reasoning is enforced by one function instead of relying on
// memory.
func noteMetaItem(m *repo.NoteMeta, genre string) corpusItemOut {
	return corpusItemOut{
		Genre: genre, ID: m.ID, Title: m.Title,
		Preview:   metaPreview(m.Snippet),
		ParentID:  m.ParentID,
		Published: m.Published,
		UpdatedAt: rfc3339OrEmpty(m.UpdatedAt),
		Tags:      []string{}, SourceRawIDs: []string{}, SourceWikiIDs: []string{},
	}
}

// rfc3339OrEmpty — 0 = this path didn't fetch a time, **leave it empty**. Rendering the
// zero value as `1970-01-01T00:00:00Z` states "unknown" as a specific date (F-L-46). The
// search query now fetches updated_at, so the empty branch shouldn't normally be hit;
// it's kept because "no value" always beats "a fake value".
func rfc3339OrEmpty(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return rfc3339(time.Unix(unix, 0).UTC())
}

func pathOrNil(p string) *string {
	if p == "" {
		return nil
	}
	return &p
}

func listRawItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Raw.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list raw: %w", err)
	}
	paths := usecase.RawTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, rawItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func listWikiItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Wiki.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	paths := usecase.WikiTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, wikiItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func listOutputItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Output.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list output: %w", err)
	}
	paths := usecase.OutputTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, outputItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func getRawItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Raw.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get raw: %w", err)
	}
	return rawItem(&row, ""), nil
}

func getWikiItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Wiki.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get wiki: %w", err)
	}
	item := wikiItem(&row, entryPath(ctx, deps, genreWiki, ownerID, id))
	item.Body = row.Body()
	return item, nil
}

func getOutputItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Output.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get output: %w", err)
	}
	item := outputItem(&row, entryPath(ctx, deps, genreOutput, ownerID, id))
	item.Body = row.Body()
	return item, nil
}

// subjectivityItem — the unified shape for one self-model entry. It has no
// published / excerpt / source edges: that's a real difference from the other genres,
// not applicable, so those fields are left at zero value.
func subjectivityItem(row *repo.Note) corpusItemOut {
	return corpusItemOut{
		Genre: genreSubjectivity, ID: row.ID, Title: row.Title, Body: row.Body,
		Preview: usecase.LeadLine(row.Body, previewMaxLen),
		Tags:    nonNilStrings(row.Tags), ShowAsSource: row.ShowAsSource,
		SourceRawIDs: []string{}, SourceWikiIDs: []string{},
		ParentID: row.ParentID,
	}
}

func listSubjectivityItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Subjectivity.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list subjectivity: %w", err)
	}
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, subjectivityItem(&rows[i]))
	}
	return out, nil
}

// getSubjectivityItem — reads back one self-model entry.
//
// It used to be unreadable: corpus.get's genre allowlist was only raw/wiki/output, and
// the error message even read "genre must be 'raw', 'wiki' or 'output'" — a sentence
// denying this genre existed at all. So it could be written (subjectivity_write) and
// deleted (corpus.delete), just **not read back**, which also meant no media could be
// attached to it (nothing could ever see the attachment afterward).
func getSubjectivityItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Subjectivity.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get subjectivity: %w", err)
	}
	return subjectivityItem(&row), nil
}

// entryPath — the tree-derived address for a single entry. Empty if it can't be
// computed: the address is only display-side sugar, and it shouldn't block a detail view
// from opening.
func entryPath(ctx context.Context, deps usecase.Deps, genre, ownerID, id string) string {
	var (
		path string
		err  error
	)
	switch genre {
	case genreWiki:
		path, err = usecase.WikiEntryPath(ctx, deps.Wiki, ownerID, id)
	case genreOutput:
		path, err = usecase.OutputEntryPath(ctx, deps.Output, ownerID, id)
	default:
		return ""
	}
	if err != nil {
		return ""
	}
	return path
}
