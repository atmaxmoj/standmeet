// uc_note_assets.go —— 一条语料身上的素材:挂上去、列出来、跟着条目一起没。
//
// **素材依附文章**。它不是独立的东西,所以这里没有"素材的权限"这个概念 —— 一个都不该有。
// 有,就说明它脱离了文章:owner 把一条 wiki 从某张码上收回,配在里面的图却还拿得到,
// 那"收回"就是假的。
//
// 两条不变量,同一个来源:
//
//	寿命    blob 的寿命 ⊆ 条目的寿命 —— 条目没了,它的字节也没了
//	可见性  blob 的可见性 ⊆ 条目的可见性 —— 读得到条目才拿得到地址
//
// 可见性那条**不靠这里判断**:素材唯一的出口是"读到了条目,顺带拿到它的素材"。读条目那一步
// 已经过了 ACL,素材挂在它后面,天然继承。没有第二条按 id 取素材的路 —— 不建那条路,
// 比建了再去守它可靠。

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// NoteAssetsDeps —— 素材这几件事要的东西。
type NoteAssetsDeps struct {
	Assets AssetsDeps
	Hero   *repo.NoteHeroRepo
}

// AttachAssetInput —— 给一条语料挂一份素材。
type AttachAssetInput struct {
	OwnerID  string
	NoteID   string
	URL      string
	Kind     string
	Filename string
}

// AttachAsset —— 按地址取一份素材,挂到这条语料上。
//
// 顺序是**先确认条目在**,再去取字节:挂到一条不存在的语料上要拒,而不是取回来落一份没人
// 认领的素材 —— 那种行是孤儿,谁也不会再看它一眼。
func AttachAsset(
	ctx context.Context, deps *NoteAssetsDeps, in *AttachAssetInput,
) (entity.Asset, error) {
	if _, err := deps.Hero.Get(ctx, in.OwnerID, in.NoteID); err != nil {
		return entity.Asset{}, fmt.Errorf("attach asset: %w", err)
	}
	media, ferr := FetchMedia(ctx, &FetchMediaInput{
		URL: in.URL, Kind: in.Kind, Filename: in.Filename,
	})
	if ferr != nil {
		return entity.Asset{}, ferr
	}
	return storeAsset(ctx, deps.Assets, in, &media)
}

// storeAsset —— DB 行先落,blob 后传。上传失败把行删掉。
//
// 这个顺序把失败模式从"MinIO 里一份谁也不认识的字节"换成"DB 里一行指向空处的素材" ——
// 后者看得见、删得掉,前者只能靠扫。
func storeAsset(
	ctx context.Context, deps AssetsDeps, in *AttachAssetInput, media *FetchedMedia,
) (entity.Asset, error) {
	prepared, ierr := insertOneAsset(ctx, deps, in.NoteID, media, kindOrImage(in.Kind))
	if ierr != nil {
		return entity.Asset{}, ierr
	}
	if _, uerr := UploadBlobs(ctx, deps, []PreparedAsset{prepared}); uerr != nil {
		// 补偿:字节没上去,那行就不该留着。补偿本身也可能失败 —— 那是一行指向空处的
		// 素材,得跟着报出去,而不是吞掉只说"上传失败"。
		if _, derr := deps.Repo.DeleteByIDs(ctx, []string{prepared.Asset.ID}); derr != nil {
			return entity.Asset{}, fmt.Errorf("upload asset: %w (row left behind: %w)", uerr, derr)
		}
		return entity.Asset{}, fmt.Errorf("upload asset: %w", uerr)
	}
	return prepared.Asset, nil
}

// insertOneAsset —— 预生成 id + storage_key,落一行(不动 MinIO)。
func insertOneAsset(
	ctx context.Context, deps AssetsDeps, noteID string, media *FetchedMedia, kind string,
) (PreparedAsset, error) {
	id, gerr := newAssetUUID()
	if gerr != nil {
		return PreparedAsset{}, gerr
	}
	asset, cerr := deps.Repo.Create(ctx, &repo.CreateAssetInput{
		ID: id, HolderID: noteID, StorageKey: noteID + "/" + id,
		ContentType: media.ContentType, SizeBytes: int64(len(media.Body)),
		SHA256: sha256Hex(media.Body), OriginalFilename: media.Filename, Kind: kind,
	})
	if cerr != nil {
		return PreparedAsset{}, fmt.Errorf("create asset row: %w", cerr)
	}
	return PreparedAsset{Asset: asset, Body: media.Body, ContentType: media.ContentType}, nil
}

func kindOrImage(k string) string {
	if k == "" {
		return entity.AssetKindImage
	}
	return k
}

// AssetView —— 一份素材读回来的样子。下载按钮要的就是这几项:名字、大小、拿得到的地址。
type AssetView struct {
	AssetID     string `json:"asset_id"`
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	Filename    string `json:"original_filename"`
	URL         string `json:"url"`
	SizeBytes   int64  `json:"size_bytes"`
}

// NoteAssets —— 一条语料身上的全部素材,带可访问地址。
//
// 调用方必须**已经确认调用者读得到这条语料** —— 可见性继承就落在那一步,这里不再判一次。
func NoteAssets(
	ctx context.Context, deps *NoteAssetsDeps, noteID string,
) ([]AssetView, error) {
	rows, err := deps.Assets.Repo.ListByHolder(ctx, noteID)
	if err != nil {
		return nil, fmt.Errorf("list note assets: %w", err)
	}
	out := make([]AssetView, 0, len(rows))
	for i := range rows {
		out = append(out, assetView(ctx, deps.Assets.Storage, &rows[i]))
	}
	return out, nil
}

func assetView(ctx context.Context, store *storage.Client, a *entity.Asset) AssetView {
	v := AssetView{
		AssetID: a.ID, Kind: a.Kind, ContentType: a.ContentType,
		Filename: a.OriginalFilename, SizeBytes: a.SizeBytes,
	}
	// 地址取不到就留空:一份素材拿不到地址不该让整条语料读不出来。
	if url, err := store.PresignedGetURL(ctx, a.StorageKey); err == nil {
		v.URL = url
	}
	return v
}

// NoteAssetURLs —— 正文里那些 standmeet-asset 引用 + hero 图 → 可访问地址。
// 渲染正文的那一侧要的是这张表。
func NoteAssetURLs(
	ctx context.Context, deps *NoteAssetsDeps, hero *entity.NoteHero,
) (map[string]string, error) {
	ids := ScanAssetReferences(hero.Body)
	if hero.CoverAssetID != "" {
		ids = append(ids, hero.CoverAssetID)
	}
	urls, err := ResolveAssetURLs(ctx, deps.Assets.Repo, deps.Assets.Storage, ids)
	if err != nil {
		return map[string]string{}, fmt.Errorf("resolve note asset urls: %w", err)
	}
	return urls, nil
}

// DeleteNoteAssets —— 删掉一条语料名下的全部素材(blob 先删,DB 行后删)。
//
// 顺序刻意如此:blob 的寿命 ⊆ 条目的寿命。反过来会留下 DB 已删、字节还在的孤儿 ——
// 那种字节谁也不认识,只能靠扫才找得回来。
func DeleteNoteAssets(ctx context.Context, deps *NoteAssetsDeps, noteID string) error {
	rows, err := deps.Assets.Repo.ListByHolder(ctx, noteID)
	if err != nil {
		return fmt.Errorf("list note assets: %w", err)
	}
	keys := make([]string, 0, len(rows))
	for i := range rows {
		keys = append(keys, rows[i].StorageKey)
	}
	if derr := DeleteBlobsStrict(ctx, deps.Assets, keys); derr != nil {
		return derr
	}
	if _, rerr := deps.Assets.Repo.DeleteByHolder(ctx, noteID); rerr != nil {
		return fmt.Errorf("delete note asset rows: %w", rerr)
	}
	return nil
}

// SetNoteHero —— 改 hero 区。**只覆盖这次给了的那几项**:先读回现值,再整份写回。
// 否则 corpus.update 的既有调用方(一个 hero 字段都不带)会把 owner 设好的 hero 抹掉。
func SetNoteHero(
	ctx context.Context, deps *NoteAssetsDeps, ownerID, noteID string, in *HeroPatch,
) error {
	cur, err := deps.Hero.Get(ctx, ownerID, noteID)
	if err != nil {
		return fmt.Errorf("read hero: %w", err)
	}
	in.applyTo(&cur)
	if serr := deps.Hero.Set(ctx, ownerID, noteID, &cur); serr != nil {
		return fmt.Errorf("write hero: %w", serr)
	}
	return nil
}

// HeroPatch —— 这次要改 hero 的哪几项。nil = 不动(不是"清空")。
type HeroPatch struct {
	CoverAssetID  *string
	CoverHeadline *string
	CoverHue      *string
}

// Touched —— 这次到底改没改 hero。全 nil 就别去读写数据库。
func (h *HeroPatch) Touched() bool {
	return h.CoverAssetID != nil || h.CoverHeadline != nil || h.CoverHue != nil
}

// applyTo —— 把这次给了的那几项盖到现值上。没给的原样留着 —— 那正是 nil 的意思。
func (h *HeroPatch) applyTo(cur *entity.NoteHero) {
	overwrite(&cur.CoverAssetID, h.CoverAssetID)
	overwrite(&cur.CoverHeadline, h.CoverHeadline)
	overwrite(&cur.CoverHue, h.CoverHue)
}

func overwrite(dst, given *string) {
	if given != nil {
		*dst = *given
	}
}
