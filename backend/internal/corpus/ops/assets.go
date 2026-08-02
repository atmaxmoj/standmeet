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
	return []fp.Op{assetsUploadOp(deps)}
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
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output'."},
		"id":{"type":"string","description":"The corpus entry this file belongs to."},
		"url":{"type":"string","description":"Public https URL the server fetches the bytes from."},
		"kind":{"type":"string","description":"'image' (default) | 'attachment'."},
		"filename":{"type":"string",
			"description":"Shown on the download button; defaults to the URL's last segment."}
	},
	"required":["genre","id","url"]
}`)

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

func uploadAsset(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseAssetUpload(raw)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("attach asset", errNoMedia)
		}
		asset, err := usecase.AttachAsset(ctx, deps.Media, &usecase.AttachAssetInput{
			OwnerID: ownerID, NoteID: args.ID, URL: args.URL,
			Kind: args.Kind, Filename: args.Filename,
		})
		if err != nil {
			return nil, assetUploadErr(err)
		}
		return marshalAssetUploaded(&asset)
	}
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

func parseAssetUpload(raw json.RawMessage) (assetUploadArgs, error) {
	var args assetUploadArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"genre", args.Genre}, [2]string{"id", args.ID}, [2]string{"url", args.URL},
	); err != nil {
		return args, err
	}
	switch args.Genre {
	case genreRaw, genreWiki, genreOutput:
	default:
		return args, fp.BadInput("genre must be one of raw, wiki, output")
	}
	return args, nil
}
