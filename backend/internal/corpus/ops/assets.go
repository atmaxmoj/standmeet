// assets.go —— 给一条语料挂一份素材。**任意 genre**。
//
// 这一步以前不存在。挂图只有一条路:写一篇 writing 的时候把内联图片的地址一起交上去
// (writing_create 的 files)。于是"素材"从来不是一件独立的事,而是 writing 这个操作
// 的一部分 —— 一条 raw、一条 wiki 想要一张配图,没有任何说法。
//
// 现在它是独立一步:先挂素材拿到 asset_id,再在正文里引 `standmeet-asset:<id>`,或者把它
// 设成 hero 图。这也是 writing_create 那个 fp.Only 欠着的前提 —— 两个面并成一个 op 之前,
// 得先有"上传素材"这一步。
//
// 地址是 owner 给的 https 地址,服务端自己去取(跟他真实的用法一样:图在图床上,他给
// AI 一个链接)。取回那一路的全部守卫在 usecase/uc_media_guard.go。

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// errNoMedia —— 这次装配没接素材存储。跟"素材不合格"是两回事:那是调用方的输入问题,
// 这是本机没配好。
var errNoMedia = errors.New("media storage is not configured")

// AssetOps —— 素材这一族操作。
func AssetOps(deps usecase.Deps) []fp.Op {
	return []fp.Op{assetsUploadOp(deps), assetsDeleteOp(deps)}
}

func assetsDeleteOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID: "assets.delete",
		Description: "Remove one file from a corpus entry. If it was the entry's cover, " +
			"the cover is cleared too. Body references to it stop resolving, so drop " +
			"the 'standmeet-asset:<asset_id>' text from the body as well.",
		InputSchema: assetDeleteSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      deleteAsset(deps),
	}
}

var assetDeleteSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
		"id":{"type":"string","description":"The corpus entry the file is attached to."},
		"asset_id":{"type":"string","description":"Which file, as returned by assets.upload."}
	},
	"required":["genre","id","asset_id"]
}`)

type assetDeleteArgs struct {
	Genre   string `json:"genre"`
	ID      string `json:"id"`
	AssetID string `json:"asset_id"`
}

func deleteAsset(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseAssetDelete(raw)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("delete asset", errNoMedia)
		}
		err := usecase.DeleteNoteAsset(ctx, deps.Media, ownerID, args.ID, args.AssetID)
		if err != nil {
			return nil, assetDeleteErr(err)
		}
		return json.RawMessage(`{"deleted":true}`), nil
	}
}

// assetDeleteErr —— 找不到就是找不到。素材没有独立的权限,"不是这条语料下面的"跟
// "根本没这个 id"对调用方是同一件事,也**应该**是同一件事:两者分开答,就等于回答了
// "这个 id 存在吗"。
func assetDeleteErr(err error) error {
	if errors.Is(err, entity.ErrEntryNotFound) {
		return fp.NotFound("no such file on this corpus entry")
	}
	return fp.OpErr("delete asset", err)
}

func parseAssetDelete(raw json.RawMessage) (assetDeleteArgs, error) {
	var args assetDeleteArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"genre", args.Genre}, [2]string{"id", args.ID},
		[2]string{"asset_id", args.AssetID},
	); err != nil {
		return args, err
	}
	return args, nil
}

func assetsUploadOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID: "assets.upload",
		Description: "Attach a file to a corpus entry of any genre (raw / wiki / output). " +
			"The server fetches `url` itself, so pass a public https link. kind='image' " +
			"for inline pictures and hero art, kind='attachment' for downloadables like a " +
			"PDF. Reference the returned asset_id from the body as " +
			"'standmeet-asset:<asset_id>', or set it as cover_image_asset_id via corpus.update.",
		InputSchema: assetUploadSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      uploadAsset(deps),
	}
}

var assetUploadSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
		"id":{"type":"string","description":"The corpus entry this file belongs to."},
		"url":{"type":"string","description":"Public https URL the server fetches the bytes from."},
		"kind":{"type":"string","description":"'image' (default) | 'attachment'."},
		"filename":{"type":"string",
			"description":"Shown on the download button; defaults to the URL's last segment."}
	},
	"required":["genre","id"]
}`)

// 注:url 在 schema 里不是 required,但**对生成型的面(MCP)它实际是必填** —— 那边没有
// 文件挑选框,owner 递的只能是地址。它松在 schema 里,是因为面板那条同一个 op 递的是随行
// 字节;两者择一由 parseAssetUpload 判,错了会说"missing required field: url
// (or attach the file itself)"。写死在 schema 里的话,面板那条永远过不了这一关。

type assetUploadArgs struct {
	Genre    string `json:"genre"`
	ID       string `json:"id"`
	URL      string `json:"url"`
	Kind     string `json:"kind"`
	Filename string `json:"filename"`
}

// assetUploadOut —— 挂好之后回什么。asset_id 是接下来引用它的唯一钥匙。
type assetUploadOut struct {
	AssetID     string `json:"asset_id"`
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	Filename    string `json:"original_filename"`
	SizeBytes   int64  `json:"size_bytes"`
}

// uploadAsset —— 一件事,两条来路。
//
//	owner 通过 AI    递一个 https 地址(图在图床上)—— 服务端自己去取
//	owner 在面板上   递字节(文件在他机器里)—— 随行字节走 ctx
//
// 两条在这里合流,再往下就只有一条:同一套素材守卫、同一个落库顺序。分成两个 op 的话,
// 面板那条就不在收口的账上,MCP 面不知道它存在,策略链也不套它 —— 那正是这条 op 一开始
// 只收地址、面板只能绕过收口直连域的原因。
func uploadAsset(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		files := fp.FilesFrom(ctx)
		args, perr := parseAssetUpload(raw, files)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("attach asset", errNoMedia)
		}
		asset, err := attachEitherWay(ctx, deps, ownerID, &args, files)
		if err != nil {
			return nil, assetUploadErr(err)
		}
		return marshalAssetUploaded(&asset)
	}
}

func attachEitherWay(
	ctx context.Context, deps usecase.Deps, ownerID string,
	args *assetUploadArgs, files []fp.File,
) (entity.Asset, error) {
	if len(files) == 0 {
		return usecase.AttachAsset(ctx, deps.Media, &usecase.AttachAssetInput{
			OwnerID: ownerID, NoteID: args.ID, URL: args.URL,
			Kind: args.Kind, Filename: args.Filename,
		})
	}
	f := files[0]
	return usecase.AttachAssetBytes(ctx, deps.Media, &usecase.AttachBytesInput{
		OwnerID: ownerID, NoteID: args.ID, Kind: args.Kind,
		Filename:    pickName(args.Filename, f.Filename),
		ContentType: f.ContentType, Body: f.Body,
	})
}

// pickName —— 显式给的文件名优先;没给就用文件自带的那个。
func pickName(given, fromFile string) string {
	if given != "" {
		return given
	}
	return fromFile
}

func marshalAssetUploaded(a *entity.Asset) (json.RawMessage, error) {
	out, err := json.Marshal(assetUploadOut{
		AssetID: a.ID, Kind: a.Kind, ContentType: a.ContentType,
		Filename: a.OriginalFilename, SizeBytes: a.SizeBytes,
	})
	if err != nil {
		return nil, fp.OpErr("encode asset", err)
	}
	return out, nil
}

// assetUploadErr —— 素材不收是**调用方的输入问题**,不是本机故障:说清楚哪儿不对,
// 让 AI 换一个地址重来,而不是回一个 500 让它以为服务坏了。
func assetUploadErr(err error) error {
	switch {
	case errors.Is(err, entity.ErrEntryNotFound):
		return fp.NotFound("corpus entry not found: nothing with this id to attach to")
	case usecase.MediaRejected(err):
		return fp.BadInput(err.Error())
	default:
		return fp.OpErr("attach asset", err)
	}
}

// parseAssetUpload —— files 是这次随行的字节。带了字节还要求 url,等于逼面板先把文件传到
// 别处再贴链接回来;不带字节又不给 url,就没有任何东西可挂。
func parseAssetUpload(raw json.RawMessage, files []fp.File) (assetUploadArgs, error) {
	var args assetUploadArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"genre", args.Genre}, [2]string{"id", args.ID},
	); err != nil {
		return args, err
	}
	if err := requireSource(args.URL, files); err != nil {
		return args, err
	}
	return args, validGenre(args.Genre)
}

func requireSource(url string, files []fp.File) error {
	if url == "" && len(files) == 0 {
		return fp.BadInput("missing required field: url (or attach the file itself)")
	}
	return nil
}

// validGenre —— 挂素材的 genre:**四个都算**,包括 subjectivity。
//
// 底下的机制一直是 genre 无关的(assets 按 holder_id 挂,没有 genre 列;hero 就在共享的
// corpus_notes 上,NoteHeroRepo 只按 id+owner 取)。这里以前少一个,纯粹是白名单漏写 ——
// 而这个特性的全部意思就是"不挑 genre",漏一个就等于这句话是假的。
func validGenre(genre string) error {
	switch genre {
	case genreRaw, genreWiki, genreOutput, genreSubjectivity:
		return nil
	default:
		return fp.BadInput("genre must be one of raw, wiki, output, subjectivity")
	}
}
