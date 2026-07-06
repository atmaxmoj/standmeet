// corpus_lister_pg_read.go —— pgCorpusLister.Get: read one entry by path. Preserves the
// old dispatchRead semantics — try wiki → output → writing, serve the FIRST that exists
// AND passes ACL (a denied wiki must not mask an allowed output at the same path); if
// some genre has the path but none is allowed → ErrCorpusDenied; if none has it →
// ErrCorpusNotFound. Path→id resolves fresh per genre (wiki/output down-walk, writing by
// its path column) — no seen-cache, no in-memory window.

package usecases

import "context"

// Get —— see file header.
func (l *pgCorpusLister) Get(
	ctx context.Context, ownerID string, grantedGlobs []string, path string,
) (CorpusEntry, error) {
	foundAny := false
	for _, find := range l.finders() {
		entry, found := find(ctx, ownerID, path)
		if !found {
			continue
		}
		foundAny = true
		if allowsCorpusURI(grantedGlobs, entry.Genre, path) {
			l.fillCSSClasses(ctx, ownerID, &entry)
			return entry, nil
		}
	}
	if foundAny {
		return CorpusEntry{}, ErrCorpusDenied
	}
	return CorpusEntry{}, ErrCorpusNotFound
}

// fillCSSClasses —— 补 per-note cssclasses(呈现钩子),best-effort;queryRepo 缺则原样。
func (l *pgCorpusLister) fillCSSClasses(ctx context.Context, ownerID string, entry *CorpusEntry) {
	if l.queryRepo != nil {
		entry.CSSClasses = l.queryRepo.GetCSSClasses(ctx, ownerID, entry.ID)
	}
}

// finders —— per-genre path→entry resolvers in dispatchRead order (wiki, output, writing).
func (l *pgCorpusLister) finders() []func(context.Context, string, string) (CorpusEntry, bool) {
	return []func(context.Context, string, string) (CorpusEntry, bool){
		l.findWiki, l.findOutput, l.findWriting, l.findSubjectivity,
	}
}

func (l *pgCorpusLister) findSubjectivity(
	ctx context.Context, ownerID, path string,
) (CorpusEntry, bool) {
	if l.subjectivity == nil {
		return CorpusEntry{}, false
	}
	id, rerr := resolveNoteNodeID(ctx, l.subjectivity, ownerID, path)
	if rerr != nil {
		return CorpusEntry{}, false
	}
	n, gerr := l.subjectivity.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return CorpusEntry{}, false
	}
	return CorpusEntry{
		ID: n.ID, Path: path, Title: n.Title, Genre: "subjectivity", Body: n.Body,
	}, true
}

func (l *pgCorpusLister) findWiki(
	ctx context.Context, ownerID, path string,
) (CorpusEntry, bool) {
	id, rerr := resolveWikiNodeID(ctx, l.wiki, ownerID, path)
	if rerr != nil {
		return CorpusEntry{}, false
	}
	w, gerr := l.wiki.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return CorpusEntry{}, false
	}
	return CorpusEntry{
		ID: w.ID(), Path: path, Title: w.Title(), Genre: "wiki", Body: w.Body(),
	}, true
}

func (l *pgCorpusLister) findOutput(
	ctx context.Context, ownerID, path string,
) (CorpusEntry, bool) {
	id, rerr := resolveOutputNodeID(ctx, l.output, ownerID, path)
	if rerr != nil {
		return CorpusEntry{}, false
	}
	o, gerr := l.output.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return CorpusEntry{}, false
	}
	return CorpusEntry{
		ID: o.ID(), Path: path, Title: o.Title(), Genre: "output", Body: o.Body(),
	}, true
}

func (l *pgCorpusLister) findWriting(
	ctx context.Context, ownerID, path string,
) (CorpusEntry, bool) {
	w, err := l.writing.GetPublishedByPath(ctx, ownerID, path)
	if err != nil {
		return CorpusEntry{}, false
	}
	return CorpusEntry{
		ID: w.ID(), Path: path, Title: w.Title(), Genre: "writing", Body: writingBodyText(&w),
	}, true
}
