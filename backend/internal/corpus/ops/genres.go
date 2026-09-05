// genres.go — which genres this domain has. **Answered in exactly one
// place.**
//
// Split out because this got answered wrong before: subjectivity used to be
// missing from three separate allowlists — corpus.get rejected it (the error
// message even read "genre must be 'raw', 'wiki' or 'output'", a sentence
// denying it existed), assets.upload rejected it, and corpus.delete had a
// hand-written `if genre != subjectivity` working around the check. Three
// places each answered "which genres count", so the same genre had three
// different answers across the write, read, and delete paths.
//
// One inconsistency was left after that: the write path only recognized
// three, with the rationale "the self-model is worked out in conversation,
// not typed into a form". That was a preference baked into code, not a
// product decision — the owner said it should work like every other genre.
// So **read, write, delete, and attach-asset now share one list**, and this
// file needs only one function.
//
// To add a genre: change it here. If some particular path genuinely needs a
// narrower list, write down why right here — not by quietly dropping a case
// from that path's own switch statement.

package ops

import (
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// The four genres — the same vocabulary across every surface and every path.
const (
	genreRaw          = "raw"
	genreWiki         = "wiki"
	genreOutput       = "output"
	genreSubjectivity = "subjectivity"
)

// requireGenre — which genres this domain recognizes. Shared by read / write
// / delete / attach-asset.
func requireGenre(genre string) error {
	switch genre {
	case genreRaw, genreWiki, genreOutput, genreSubjectivity:
		return nil
	default:
		return fp.Coded(
			fp.NotFound("genre must be 'raw', 'wiki', 'output' or 'subjectivity'"),
			"unknown_genre",
		)
	}
}
