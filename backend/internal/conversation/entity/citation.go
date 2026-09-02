// citation.go —— Citation: a VO referencing one corpus entry.
//
// Attaches under Dialog.Citations; both the admin transcript and the
// visitor chat UI consume it in this shape. Genre + Path address the entry
// (URI = `<genre>://<path>`); DocID is the uuid (used when the persistence
// layer writes the cited_wiki_ids / cited_output_ids / cited_writing_ids
// columns); Title is for the UI to render.
//
// One VO covers wiki + output + writing (writing is a public/published
// blog post, and always goes into cited with no show_as_source gate) —
// previously the backend stored `cited_wiki_ids[]` + `cited_output_ids[]`
// as separate columns, and the frontend maintained separate arrays too;
// now it's factored out.
//
// Genre reuses corpus.DocumentGenre (the same type as a corpus entry);
// introducing a separate CitationKind was a leftover, now removed.

package entity

import corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

// Citation —— a VO referencing one corpus entry.
type Citation struct {
	Genre Genre  // wiki / output / writing / subjectivity (raw is never cited)
	DocID string // entry uuid (used by the persistence layer)
	Path  string // entry path (addressing + UI rendering)
	Title string // entry title (UI rendering)
}

// Genre —— alias for DocumentGenre (keeps Citation.Genre shorter to write).
// Not a second enum; passing a genre outside what the cited footer covers
// (raw) into Citation is a caller bug.
type Genre = corpus.DocumentGenre
