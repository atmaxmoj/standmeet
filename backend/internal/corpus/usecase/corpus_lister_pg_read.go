// corpus_lister_pg_read.go —— pgCorpusLister.Get: read one entry by path. Preserves the
// old dispatchRead semantics — try wiki → output → writing, serve the FIRST that exists
// AND passes ACL (a denied wiki must not mask an allowed output at the same path); if
// some genre has the path but none is allowed → ErrCorpusDenied; if none has it →
// ErrCorpusNotFound. Path→id resolves fresh per genre (wiki/output down-walk, writing by
// its path column) — no seen-cache, no in-memory window.

package usecase

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// Get —— see file header.
func (l *pgCorpusLister) Get(
	ctx context.Context, ownerID string, scope access.CorpusScope, path string,
) (Entry, error) {
	foundAny := false
	for _, find := range l.finders() {
		entry, found := find(ctx, ownerID, path)
		if !found {
			continue
		}
		foundAny = true
		if allowsCorpusEntry(scope, entry.Genre, path, entry.Published) {
			l.fillCSSClasses(ctx, ownerID, &entry)
			return entry, nil
		}
	}
	if foundAny {
		return Entry{}, ErrCorpusDenied
	}
	return Entry{}, ErrCorpusNotFound
}

// fillCSSClasses —— fills in per-note cssclasses (a presentation hook), best-effort;
// leaves the entry as-is when queryRepo is absent.
func (l *pgCorpusLister) fillCSSClasses(ctx context.Context, ownerID string, entry *Entry) {
	if l.queryRepo != nil {
		entry.CSSClasses = l.queryRepo.GetCSSClasses(ctx, ownerID, entry.ID)
	}
}

// finders —— per-genre path→entry resolvers in dispatchRead order (wiki, output, writing).
func (l *pgCorpusLister) finders() []func(context.Context, string, string) (Entry, bool) {
	return []func(context.Context, string, string) (Entry, bool){
		l.findWiki, l.findOutput, l.findWriting, l.findSubjectivity,
	}
}

func (l *pgCorpusLister) findSubjectivity(
	ctx context.Context, ownerID, path string,
) (Entry, bool) {
	if l.subjectivity == nil {
		return Entry{}, false
	}
	id, rerr := resolveNoteNodeID(ctx, l.subjectivity, ownerID, path)
	if rerr != nil {
		return Entry{}, false
	}
	n, gerr := l.subjectivity.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return Entry{}, false
	}
	return Entry{
		ID: n.ID, Path: path, Title: n.Title, Genre: "subjectivity", Body: n.Body,
		Published: n.Published,
	}, true
}

func (l *pgCorpusLister) findWiki(
	ctx context.Context, ownerID, path string,
) (Entry, bool) {
	id, rerr := ResolveWikiNodeID(ctx, l.wiki, ownerID, path)
	if rerr != nil {
		return Entry{}, false
	}
	w, gerr := l.wiki.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return Entry{}, false
	}
	return Entry{
		ID: w.ID(), Path: path, Title: w.Title(), Genre: "wiki", Body: w.Body(),
		ShowAsSource: w.ShowAsSource(), Published: w.Published(),
	}, true
}

func (l *pgCorpusLister) findOutput(
	ctx context.Context, ownerID, path string,
) (Entry, bool) {
	id, rerr := resolveOutputNodeID(ctx, l.output, ownerID, path)
	if rerr != nil {
		return Entry{}, false
	}
	o, gerr := l.output.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return Entry{}, false
	}
	return Entry{
		ID: o.ID(), Path: path, Title: o.Title(), Genre: "output", Body: o.Body(),
		ShowAsSource: o.ShowAsSource(), Published: o.Published(),
	}, true
}

func (l *pgCorpusLister) findWriting(
	ctx context.Context, ownerID, path string,
) (Entry, bool) {
	w, err := l.writing.GetPublishedByPath(ctx, ownerID, path)
	if err != nil {
		return Entry{}, false
	}
	// GetPublishedByPath lives up to its name (only returns published entries), so
	// Published is always true here — written as an explicit IsPublished() call
	// rather than a literal true: the criterion still comes from that call, not
	// from the promise implied by the function's name.
	return Entry{
		ID: w.ID(), Path: path, Slug: w.Slug(), Title: w.Title(), Genre: "writing",
		Body: writingBodyText(&w), Published: w.IsPublished(),
	}, true
}
