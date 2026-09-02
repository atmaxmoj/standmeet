// corpus_write_promote.go — promotion: raw → wiki → output.
//
// Promotion is **directional**, so corpus.promote's genre names the **source**
// genre, not the result's. output is the last stop; promoting it further has
// nowhere to go — that's a bad input, not an internal failure.
//
// Split out from corpus_write.go: create/update/delete are "write this entry
// in place"; promote is "read one entry, generate another, record the
// provenance on the new entry" — not the same operation.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func promoteCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusWrite(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs(
			[2]string{"id", in.ID}, [2]string{"title", in.Title}); err != nil {
			return nil, err
		}
		item, err := promoteByGenre(ctx, deps, ownerID, &in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(item)
	}
}

func promoteByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	if in.Genre == genreRaw {
		row, err := usecase.PromoteToWiki(ctx, deps, &usecase.PromoteInput{
			OwnerID: ownerID, RawID: in.ID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Tags: in.Tags, ShowAsSource: in.ShowAsSource,
		})
		if err != nil {
			return corpusItemOut{}, err
		}
		return wikiItem(&row, entryPath(ctx, deps, genreWiki, ownerID, row.ID())), nil
	}
	if in.Genre == genreOutput {
		return corpusItemOut{}, fp.BadInput("output is the last step; nothing to promote it to")
	}
	row, err := usecase.PromoteWikiToOutput(ctx, deps, &usecase.PromoteToOutputInput{
		OwnerID: ownerID, WikiID: in.ID, ParentID: parentOrNil(in.ParentID),
		Title: in.Title, Tags: in.Tags, ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return corpusItemOut{}, err
	}
	return outputItem(&row, entryPath(ctx, deps, genreOutput, ownerID, row.ID())), nil
}
