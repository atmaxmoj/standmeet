// uc_corpus_assets_read.go —— 读一条语料时,顺带把它身上的素材一起读出来。
//
// **可见性继承就落在这里**。素材没有自己的 ACL,也不该有:它唯一的出口是"读到了条目,
// 顺带拿到它的素材"。访客那条路走到这一步时 ACL 已经判过了 —— 读不到条目的人根本到不了
// 这里,于是"读不到文章 → 一份素材都拿不到"是**结构保证的**,不是又判一次。
//
// 反过来说:如果有第二条按 asset id 直接换地址的路,这条继承就断了 —— owner 把一条 wiki
// 从某张码上收回,配在里面的图却还拿得到。所以那条路不存在。
//
// owner 面和访客面读到的是**同一份**:两边都过这里,不是各拼一遍(各拼一遍就会出现
// "面板上看得见、访客那边漏了"这种只在运行时暴露的差别)。

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// NoteMediaView —— 一条语料身上跟素材有关的全部:hero 三件套(在 Hero 里)、素材清单、
// 正文里那些 standmeet-asset 引用解析出的地址。
type NoteMediaView struct {
	URLs   map[string]string
	Hero   entity.NoteHero
	Assets []AssetView
}

// ready —— 这次装配接了素材存储没有。没接(某些只读路径)→ 读写素材那几步跳过。
func (d *NoteAssetsDeps) ready() bool {
	return d != nil && d.Hero != nil && d.Assets.Repo != nil
}

// LoadNoteMedia —— 读一条语料的素材。ok=false 表示这条读不出来(没接存储 / 不是这个
// owner 的 / 不存在),调用方当"没有素材"处理。
//
// 单份素材出问题只丢那一份:一张图拿不到地址不该让整条语料读不出来。
func LoadNoteMedia(
	ctx context.Context, deps *NoteAssetsDeps, ownerID, noteID string,
) (NoteMediaView, bool) {
	out := NoteMediaView{Assets: []AssetView{}, URLs: map[string]string{}}
	if !deps.ready() {
		return out, false
	}
	hero, herr := deps.Hero.Get(ctx, ownerID, noteID)
	if herr != nil {
		return out, false
	}
	out.Hero = hero
	if urls, uerr := NoteAssetURLs(ctx, deps, &hero); uerr == nil {
		out.URLs = urls
	}
	if assets, aerr := NoteAssets(ctx, deps, noteID); aerr == nil {
		out.Assets = assets
	}
	return out, true
}

// assetReader —— 能给出一条语料素材的 lister。pgCorpusLister 在接了素材存储时实现它;
// agentcore 的 eval mini-host 不实现 → 读回的结果里就没有素材那几项。
type assetReader interface {
	NoteMedia(ctx context.Context, ownerID, noteID string) ([]AssetView, map[string]string)
}

// NoteMedia —— 访客读到一条语料时,它身上的素材清单 + 引用解析出的地址。
func (l *pgCorpusLister) NoteMedia(
	ctx context.Context, ownerID, noteID string,
) ([]AssetView, map[string]string) {
	media, _ := LoadNoteMedia(ctx, l.media, ownerID, noteID)
	return media.Assets, media.URLs
}
