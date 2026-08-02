// writings_create.go —— 写一篇长文。
//
// 它是本域最后一个从 ownercore 回家的操作,而且回来得比该来的时候晚:那个包的注释一直
// 写着"字节流进不了一个 JSON op",于是这条被当成**搬不动**的。可它从来就不是字节流 ——
// MCP 这条路径收的是一串 https 地址,服务端自己去取(见 writings_inline_files.go)。
//
// 真正搬不动的是**把两个面并成一个 op**:面板那边是 multipart(正文里的内联图片跟表单
// 一起传),那要先把"上传素材"拆成独立一步。两件事被混成了一件,于是一件都没做。
//
// 所以这条现在 Reach = Only(理由, "mcp"):它在收口里登记着,MCP 面照常投影,admin 面
// 照旧走自己那条手写的 multipart 路由 —— 差异写在声明里,有理由、看得见,而不是靠一个
// 包躲在收口外面。素材那笔债还清时,把 Only 去掉,admin 那条路由跟着消失。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// writingCreateReason —— Only 的理由。写全,因为它同时是"什么时候可以去掉它"的判据。
const writingCreateReason = "the admin face posts multipart (inline images travel with the " +
	"form) while this takes a list of URLs the server fetches; unifying them needs asset " +
	"upload split into its own step first"

// writingsCreateOp —— 建一篇长文。跟 Writings() 那四个同域,但单独一个文件:它带着一份
// 自己的欠账说明,不该混在"列出/发布/删除"里读。
func writingsCreateOp(deps WritingsDeps) fp.Op {
	return fp.Op{
		// id 就是 MCP 工具名,保持**历史名字** —— 它已经发出去了。跟旁边的 writings.list /
		// publish / delete 不一致是真的,但改名的代价落在每个调用方身上,而一致只是好看。
		// (prompt_create / role_create 同理。)
		ID: "writing_create",
		Description: "Write a long-form piece to the owner's /writings. body_md is " +
			"GitHub-flavored markdown; publish=true makes it visible immediately, otherwise " +
			"draft. Inline images go in `files` as {pending_id, url}; body_md and " +
			"cover_image_asset_id reference them as 'standmeet-asset:pending-<id>'.",
		InputSchema: writingCreateSchema,
		Kind:        fp.Action,
		Reach:       fp.Only(writingCreateReason, "mcp"),
		Invoke:      createWriting(deps),
	}
}

var writingCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"slug":{"type":"string"},
		"title":{"type":"string"},
		"excerpt":{"type":"string"},
		"body_md":{"type":"string"},
		"cover_headline":{"type":"string"},
		"cover_hue":{"type":"string","description":"'amber' (default) | 'violet' | 'acid'."},
		"cover_image_asset_id":{"type":"string"},
		"tags":{"type":"array","items":{"type":"string"}},
		"visibility":{"type":"string","description":"'public' (default) | 'private'."},
		"cross_refs":{"type":"array","items":{"type":"string"}},
		"locked_body":{"type":"string"},
		"parent_id":{"type":"string","description":"Optional parent writing id (reader tree)."},
		"publish":{"type":"boolean"},
		"files":{"type":"array","items":{"type":"object",
			"properties":{
				"pending_id":{"type":"string"},
				"url":{"type":"string"}
			},
			"required":["pending_id","url"]}}
	},
	"required":["slug","title"]
}`)

type writingCreateArgs struct {
	Slug              string           `json:"slug"`
	Title             string           `json:"title"`
	Excerpt           string           `json:"excerpt"`
	BodyMD            string           `json:"body_md"`
	CoverHeadline     string           `json:"cover_headline"`
	CoverHue          string           `json:"cover_hue"`
	CoverImageAssetID string           `json:"cover_image_asset_id"`
	Visibility        string           `json:"visibility"`
	LockedBody        string           `json:"locked_body"`
	ParentID          string           `json:"parent_id"`
	Tags              []string         `json:"tags"`
	CrossRefs         []string         `json:"cross_refs"`
	Files             []writingFileRef `json:"files"`
	Publish           bool             `json:"publish"`
}

// writingCreateOut —— 建好之后回什么:建成了、在哪儿、发没发。
type writingCreateOut struct {
	WritingID string `json:"writing_id"`
	Slug      string `json:"slug"`
	Published bool   `json:"published"`
}

func createWriting(deps WritingsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseWritingCreate(raw)
		if perr != nil {
			return nil, perr
		}
		in, ferr := saveInputWithFiles(ctx, &args, ownerID)
		if ferr != nil {
			return nil, ferr
		}
		wg, err := usecase.SaveWriting(ctx, deps.Tx, in)
		if err != nil {
			return nil, writingCreateErr(deps.Log, err)
		}
		return marshalWritingCreated(&wg)
	}
}

// saveInputWithFiles —— 把入参装成保存输入,顺带把内联配图按地址取回来。
// 任一张取不回来 → 整篇不保存:一篇正文里挂着取不到的图,比保存失败更难查。
func saveInputWithFiles(
	ctx context.Context, args *writingCreateArgs, ownerID string,
) (*usecase.SaveWritingInput, error) {
	files, ferr := fetchInlineFiles(ctx, args.Files)
	if ferr != nil {
		return nil, fp.BadInput(ferr.Error())
	}
	in := writingSaveInput(args, ownerID)
	in.Files = files
	return in, nil
}

func marshalWritingCreated(wg *entity.Writing) (json.RawMessage, error) {
	out, err := json.Marshal(writingCreateOut{
		WritingID: wg.ID(), Slug: wg.Slug(), Published: wg.IsPublished(),
	})
	if err != nil {
		return nil, fp.OpErr("encode writing", err)
	}
	return out, nil
}

func writingCreateErr(log *slog.Logger, err error) error {
	if errors.Is(err, entity.ErrWritingSlugTaken) {
		return fp.Coded(fp.Conflict("a writing with this slug already exists"), "slug_taken")
	}
	log.Error("writings.create", "err", err)
	return fp.OpErr("create writing", err)
}

func parseWritingCreate(raw json.RawMessage) (writingCreateArgs, error) {
	var args writingCreateArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"slug", args.Slug}, [2]string{"title", args.Title},
	); err != nil {
		return args, err
	}
	applyWritingCreateDefaults(&args)
	return args, nil
}

func applyWritingCreateDefaults(args *writingCreateArgs) {
	if args.CoverHue == "" {
		args.CoverHue = "amber"
	}
	if args.Visibility == "" {
		args.Visibility = "public"
	}
}

func writingSaveInput(args *writingCreateArgs, ownerID string) *usecase.SaveWritingInput {
	return &usecase.SaveWritingInput{
		OwnerID: ownerID, Slug: args.Slug, Title: args.Title,
		Excerpt:       args.Excerpt,
		BodyMD:        args.BodyMD,
		CoverImageRef: args.CoverImageAssetID,
		CoverHeadline: args.CoverHeadline,
		CoverHue:      args.CoverHue,
		Tags:          nonNilStrings(args.Tags),
		Visibility:    args.Visibility,
		CrossRefs:     nonNilStrings(args.CrossRefs),
		LockedBody:    args.LockedBody,
		ParentID:      args.ParentID,
		Publish:       args.Publish,
	}
}
