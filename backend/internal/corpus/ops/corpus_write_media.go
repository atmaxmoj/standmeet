// corpus_write_media.go —— 语料的写里跟**素材**有关的那一半:hero 区,以及删条目时素材
// 跟着一起没。
//
// hero 跟条目本身是**两件事**,写路径也得分开:条目那半是"整份替换"(没给的字段就是清空),
// hero 这半是"只覆盖这次给了的"。把两者混在一个替换里会出一个很难看的结果 —— owner 只是
// 给一条 wiki 配了张图,结果标题和正文被一份空入参洗掉了。
//
// 反过来也一样:既有的调用方(改正文,一个 hero 字段都不带)不该把 owner 设好的 hero 抹掉。
// 所以入参里 hero 三项是指针,nil = 不动。

package ops

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// heroPatch —— 这次要改 hero 的哪几项。
func (a *corpusWriteArgs) heroPatch() usecase.HeroPatch {
	return usecase.HeroPatch{
		CoverAssetID: a.CoverImageAssetID, CoverHeadline: a.CoverHeadline, CoverHue: a.CoverHue,
	}
}

// entryTouched —— 这次动没动条目本身(而不是只动 hero)。
//
// 只改 hero 时不能顺手跑一遍整份替换:那会拿一份空的 title/body 把条目洗掉 ——
// "只是给它配了张图"变成"把它清空了"。
func (a *corpusWriteArgs) entryTouched() bool {
	given := []bool{
		a.Title != "", a.Body != "", a.ParentID != "",
		len(a.Tags) > 0, len(a.CSSClasses) > 0, a.ShowAsSource != nil, a.FlaggedPrivate,
	}
	for _, g := range given {
		if g {
			return true
		}
	}
	return false
}

// applyCorpusUpdate —— hero 和条目本身是两件事,分开落。
//
// 只给了 hero 就只改 hero,再把条目现值读回来当回执 —— 而不是拿一份空入参跑整份替换。
func applyCorpusUpdate(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	hero := in.heroPatch()
	if !hero.Touched() {
		return updateByGenre(ctx, deps, ownerID, in)
	}
	if err := writeHero(ctx, deps, ownerID, in.ID, &hero); err != nil {
		return corpusItemOut{}, err
	}
	if in.entryTouched() {
		return updateByGenre(ctx, deps, ownerID, in)
	}
	return getByGenre(ctx, deps, ownerID, corpusGetArgs{Genre: in.Genre, ID: in.ID})
}

func writeHero(
	ctx context.Context, deps usecase.Deps, ownerID, id string, hero *usecase.HeroPatch,
) error {
	if !deps.HasMedia() {
		return fp.OpErr("set hero", errNoMedia)
	}
	return usecase.SetNoteHero(ctx, deps.Media, ownerID, id, hero)
}

// dropEntryAssets —— 删条目之前先把它名下的素材删干净。
//
// 素材先没,条目后没。反过来会留下"条目已删、字节还在"的孤儿 —— 那种字节谁也不认识,
// 只能靠扫才找得回来;反之则是一条少了配图的语料,看得见、补得回。
func dropEntryAssets(ctx context.Context, deps usecase.Deps, id string) error {
	if !deps.HasMedia() {
		return nil
	}
	return usecase.DeleteNoteAssets(ctx, deps.Media, id)
}
