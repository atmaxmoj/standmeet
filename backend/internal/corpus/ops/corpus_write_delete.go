// corpus_write_delete.go —— delete one corpus entry (declared in corpus_write.go).
//
// Pulled into its own file only to keep that file under its line-count limit; delete is one
// third of the same operation group as create/update — don't look for a second semantics here.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func deleteCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusDelete(raw)
		if perr != nil {
			return nil, perr
		}
		if err := dropEntryAssets(ctx, deps, in.ID); err != nil {
			return nil, corpusErr(err)
		}
		if err := deleteByGenre(ctx, deps, ownerID, in.Genre, in.ID); err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(deletedOut{Genre: in.Genre, ID: in.ID, Deleted: true})
	}
}

// decodeCorpusDelete —— delete accepts one extra genre: subjectivity can only be deleted,
// it has no other write op (it's written by the owner's own AI, see subjectivity.go).
func decodeCorpusDelete(raw json.RawMessage) (corpusGetArgs, error) {
	var in corpusGetArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := requireGenre(in.Genre); err != nil {
		return in, err
	}
	return in, fp.RequireArgs([2]string{"id", in.ID})
}

// deleteByGenre —— delete means delete, **the same for all three genres**.
//
// raw used to go through "archiving" instead: the row stayed, archived flipped to true. That
// wasn't a different semantics, just the same thing under a different name — no list ever shows
// it again (ListRaw always filters archived=false), there's no restore path, and the panel
// button labeled archive actually hits DELETE. So the name `corpus.delete` was a lie on raw:
// the owner's AI says "delete this one", gets back deleted:true, and the database still holds
// a tombstone row nobody can ever read.
//
// A delete action meaning different things on different genres would make the caller have to
// remember which is which — and it can't.
func deleteByGenre(
	ctx context.Context, deps usecase.Deps, ownerID, genre, id string,
) error {
	switch genre {
	case genreRaw:
		return usecase.DeleteRaw(ctx, deps, ownerID, id)
	case genreWiki:
		return usecase.DeleteWiki(ctx, deps, ownerID, id)
	case genreSubjectivity:
		return usecase.DeleteSubjectivity(ctx, deps, ownerID, id)
	default:
		return usecase.DeleteOutput(ctx, deps, ownerID, id)
	}
}
