// corpus_write_promote.go —— 提升:raw → wiki → output。
//
// 提升是**有方向的**,所以 corpus.promote 的 genre 说的是**源**的 genre,不是结果的。
// output 是最后一站,再提升没有去处 —— 那是入参错,不是内部故障。
//
// 从 corpus_write.go 拆出来:建/改/删是"就地写这一条",提升是"读一条、生成另一条、
// 把来源记在新条目上",不是同一件事。

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
