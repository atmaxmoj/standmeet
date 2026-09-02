// genres.go — the **single definition site** for the five discriminator values of
// corpus_notes.genre. The five genres (raw / wiki / output / writing / subjectivity) are all
// peers; grouping them here is only because they're one enum from one source, not because
// any of them are specially paired or grouped with each other. (They used to be scattered
// across wiki.go / output.go / corpus_tree.go, which also misleadingly lumped raw+writing
// together.)
//
// Aligned verbatim with DocumentGenre. subjectivity used to be missing here — this layer was
// simply "one genre short", so it had no tree and no admin listing, and the owner couldn't
// even see where their own CV lived (F-A-15).

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const (
	genreRaw          = "raw"
	genreWiki         = "wiki"
	genreOutput       = "output"
	genreWriting      = "writing"
	genreSubjectivity = "subjectivity"
)

// listNoteMetaBy — the shared body behind wiki/output's ListAllMeta: pulls the full set of
// note meta rows for a genre, then uses mk to map each row into its own Meta type (dedupes
// what used to be two near-identical implementations, dupl-clean).
func listNoteMetaBy[T any](
	ctx context.Context, pool *pgstore.Pool, ownerID, genre string,
	mk func(*db.ListAllNoteMetaRow) T,
) ([]T, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(pool).ListAllNoteMeta(ctx, db.ListAllNoteMetaParams{
		OwnerID: ownerUUID, Genre: genre,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list all %s meta: %w", genre, qerr)
	}
	out := make([]T, 0, len(rows))
	for i := range rows {
		out = append(out, mk(&rows[i]))
	}
	return out, nil
}
