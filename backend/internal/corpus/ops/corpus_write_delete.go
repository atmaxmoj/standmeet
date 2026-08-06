// corpus_write_delete.go —— 删一条语料(声明在 corpus_write.go)。
//
// 单拎出来只为守住那个文件的行数上限;删跟建/改是同一组操作的三分之一,别在这儿找第二套语义。

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

// decodeCorpusDelete —— 删多认一个 genre:subjectivity 只能删,不走别的写口
// (它是 owner 跟自己的 AI 写出来的,见 subjectivity.go)。
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

// deleteByGenre —— 删就是删,**三个 genre 一个样**。
//
// raw 以前走的是"归档":行留着,archived 置 true。那不是另一种语义,是同一件事换了个名字 ——
// 没有任何列表会再显示它(ListRaw 永远过滤 archived=false),没有恢复的入口,面板上那个
// 写着 archive 的按钮打的就是 DELETE。于是 `corpus.delete` 这个名字在 raw 上是假的:
// owner 的 AI 说"删掉这条",拿到 deleted:true,而库里留着一行谁也读不到的墓碑。
//
// 一个删除动作在不同 genre 上意味着不同的事,调用方就得记住哪个是哪个 —— 而它记不住。
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
