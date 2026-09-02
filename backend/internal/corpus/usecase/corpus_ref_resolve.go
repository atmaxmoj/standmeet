// corpus_ref_resolve.go — whether a corpus URI reference (`genre://path`)
// resolves to a real note.
//
// Who needs this: ghost-steering's waypoint freeze (F-A-26). The owner writes
// evidence_refs on a waypoint's role; if a ref points at nothing, it creates a
// **permanently unreachable** steering destination — WaypointLedger marks
// visited by taking "the note actually cited this turn," building its URI from
// (genre, tree path), and comparing that against refs. With no matching note,
// that URI can never be built, so the ghost keeps re-pushing it every turn,
// never settling down silently.
//
// **The criterion here must match the ledger's exactly**, so this reuses
// pgCorpusLister's per-genre finder, and defines "resolves" as: a note exists
// whose genre and tree path build **exactly** this ref.
//
// Get can't substitute for this: Get searches across genres by path and
// returns the first hit, so if wiki has a "standpoint" entry, it would make
// subjectivity://standpoint count as resolved when the ledger never would —
// that just regrows the same hole somewhere else.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// RefResolver — see the file header. A concrete type rather than an interface
// (avoids ireturn); consumers accept it through their own narrow subset.
type RefResolver struct {
	lister *pgCorpusLister
}

// NewRefResolver — prod: shares the same IndexDeps and the same set of finders
// as corpus host ops.
func NewRefResolver(deps *IndexDeps) *RefResolver {
	return &RefResolver{lister: newPGLister(deps)}
}

// ResolvesRef — does this ref resolve to a real note? Invalid syntax /
// unrecognized genre / no such note → false. **Does not check ACL** —
// "can this role see it" is a separate concern, owned by the authorization
// gate (FilterWaypointsByCorpus); this function only answers existence, and
// keeping the two apart lets each one say clearly what it's answering.
func (r *RefResolver) ResolvesRef(ctx context.Context, ownerID, uri string) bool {
	ref, err := entity.ParseURI(uri)
	if err != nil {
		return false
	}
	for _, find := range r.lister.finders() {
		entry, found := find(ctx, ownerID, ref.Path)
		if found && entry.Genre == string(ref.Genre) {
			return true
		}
	}
	return false
}
