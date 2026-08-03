// writings_create.go —— 写一篇长文。
//
// 它是本域最后一个从 ownercore 回家的操作,而且回来得比该来的时候晚:那个包的注释一直
// 写着"字节流进不了一个 JSON op",于是这条被当成**搬不动**的。可它从来就不是字节流 ——
// MCP 这条路径收的是一串 https 地址,服务端自己去取(见 writings_inline_files.go)。
//
// 真正搬不动的是**把两个面并成一个 op**:面板那边是 multipart(正文里的内联图片跟表单
// 一起传),那要先把"上传素材"拆成独立一步。两件事被混成了一件,于是一件都没做。
//
// 那笔债现在还清了,分两步:
//
//  1. 「上传素材」成了独立一步(assets.upload,任意 genre);
//  2. 收口有了**携带字节的通道**(fp.File / WithFiles / Face.OpFiles)—— 缺的一直是这个,
//     所以"面板走 multipart"才只能表现为绕过收口。
//
// 于是 Reach 从 Only(理由,"mcp") 变回 OwnerAction():同一个 op,两条来路 ——
// AI 给一串 https 地址(服务端自己去取),浏览器给字节(field 名 `file:<pending-id>`)。
// 两条在 saveInputWithFiles 合流,往下只有一条路。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// 这里以前有一个 writingCreateReason 常量 —— Only 的理由,写着"面板发 multipart 而这条
// 收一串地址,并成一个 op 得先把上传素材拆成独立一步"。两件事都做完了,理由和 Only 一起删。

// writingsCreateOp —— 写一篇长文(建或改)。跟 Writings() 那四个同域,但单独一个文件:
// 它是本域唯一收随行字节的 op,那一段值得单独读。
func writingsCreateOp(deps WritingsDeps) fp.Op {
	return fp.Op{
		// id 就是 MCP 工具名,保持**历史名字** —— 它已经发出去了。跟旁边的 writings.list /
		// publish / delete 不一致是真的,但改名的代价落在每个调用方身上,而一致只是好看。
		// (prompt_create / role_create 同理。)
		ID: "writing_create",
		Description: "Write a long-form piece to the owner's /writings, or update one by " +
			"passing writing_id. body_md is GitHub-flavored markdown; publish=true makes it " +
			"visible immediately, otherwise draft. Inline images go in `files` as " +
			"{pending_id, url}; body_md and cover_image_asset_id reference them as " +
			"'standmeet-asset:pending-<id>'.",
		InputSchema: writingCreateSchema,
		Kind:        fp.Action,
		// 两个面都欠它。以前是 fp.Only(..., "mcp"):面板那条走 multipart,而收口没有携带
		// 字节的通道,于是它只能绕过收口直连域(见 check-routes-via-dispatcher 的基线)。
		// 通道建好之后那个理由就没了 —— 同一个 op,两条来路(AI 给地址 / 浏览器给字节)。
		Reach:  fp.OwnerAction(),
		Invoke: createWriting(deps),
	}
}

var writingCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"writing_id":{"type":"string",
			"description":"Existing writing to update; empty creates a new one."},
		"slug":{"type":"string",
			"description":"Required when creating; on update the address is already set."},
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
	WritingID         string           `json:"writing_id"`
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

// 回参就是 writingOut(writings.list 那一份)。以前这里另有一个三字段的
// writingCreateOut{writing_id, slug, published} —— 同一个资源于是有了两份形状,
// 而"两份形状"正是收口要消掉的东西。writing_id 这个键仍在(见 marshalWritingSaved),
// owner 的 AI 一直按它读。

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
		// 回**完整视图**(跟 writings.list 逐字同一份形状),不是三个字段的收条。
		// 面板保存完要立刻渲这一条 —— 回参不全,它就得再发一次读请求,或者自己拼一份
		// 视图出来,而那正是两个面长成两个样子的起点。
		out := deps.toWritingOut(ctx, &wg)
		return marshalWritingSaved(&out)
	}
}

// saveInputWithFiles —— 把入参装成保存输入,顺带把内联配图收齐。
//
// 图有**两条来路**,在这里合流:
//
//	`files:[{pending_id,url}]`  owner 通过 AI 给的地址 —— 服务端自己去取
//	随行字节(fp.FilesFrom)      owner 在面板上选的文件 —— field 名是 `file:<pending_id>`
//
// 两条都用同一个 pending_id 跟正文里的 `standmeet-asset:pending-<id>` 对上,再往下
// 就只有一条路。任一张取不回来 → 整篇不保存:一篇正文里挂着取不到的图,比保存失败更难查。
func saveInputWithFiles(
	ctx context.Context, args *writingCreateArgs, ownerID string,
) (*usecase.SaveWritingInput, error) {
	files, ferr := fetchInlineFiles(ctx, args.Files)
	if ferr != nil {
		return nil, fp.BadInput(ferr.Error())
	}
	in := writingSaveInput(args, ownerID)
	carried := carriedFiles(ctx)
	all := make([]usecase.FileInput, 0, len(files)+len(carried))
	all = append(all, files...)
	all = append(all, carried...)
	in.Files = all
	return in, nil
}

// carriedFilePrefix —— 随行字节的 field 名前缀。前端按 `file:<pending-id>` 起名,
// 正文里的占位是 `standmeet-asset:pending-<id>`,两边靠这个 id 对上。
const carriedFilePrefix = "file:"

// carriedFiles —— 这次调用带过来的字节。没带就是空 —— 那是"owner 给的是地址",不是坏了。
func carriedFiles(ctx context.Context) []usecase.FileInput {
	carried := fp.FilesFrom(ctx)
	out := make([]usecase.FileInput, 0, len(carried))
	for i := range carried {
		pending, ok := strings.CutPrefix(carried[i].Field, carriedFilePrefix)
		if !ok {
			continue // 不是这条命名规范下的,不是给正文配图用的
		}
		out = append(out, usecase.FileInput{
			PendingID: pending, ContentType: carried[i].ContentType,
			OriginalFilename: carried[i].Filename, Body: carried[i].Body,
		})
	}
	return out
}

// writingSavedOut —— 完整视图 + 一个 writing_id 别名。
//
// 别名是给 owner 的 AI 的:它一直按 `writing_id` 读建好那篇的 id,而列表那份形状里
// 这个字段叫 `id`。**加一个键比改一个键便宜** —— 改了就得每个调用方跟着改,而它们
// 在别人的机器上。
// 用 map 合并而不是内嵌 struct:内嵌要么触发"内嵌字段必须在前"、要么触发"内嵌与普通
// 字段之间要空行",两条 lint 互相咬。而这里要的就是"那份形状,外加一个键"。
func marshalWritingSaved(out *writingOut) (json.RawMessage, error) {
	b, err := json.Marshal(out)
	if err != nil {
		return nil, fp.OpErr("encode writing", err)
	}
	var fields map[string]json.RawMessage
	if uerr := json.Unmarshal(b, &fields); uerr != nil {
		return nil, fp.OpErr("encode writing", uerr)
	}
	fields["writing_id"] = json.RawMessage(strconv.Quote(out.ID))
	merged, merr := json.Marshal(fields)
	if merr != nil {
		return nil, fp.OpErr("encode writing", merr)
	}
	return merged, nil
}

// writingCreateErr —— 调用方给错了东西 vs 这台机器出问题了。
//
// 父节点那两条以前只在 admin 路由的错误表里(saveWritingErrCases)。保存搬进收口之后
// 那张表没了,而这里只认 slug 冲突 —— 于是"把一篇文章挂到自己的子孙下面"从一个
// **400 加一句人话**变成了 500。owner 看到的是"服务器错误",而错的是他刚点的那一下。
//
// 教训是搬家时的:**错误分类跟着能力走**。路由层那张表是能力的一部分,不是路由的装饰;
// 留在原地就等于把它删了。
func writingCreateErr(log *slog.Logger, err error) error {
	for _, c := range writingSaveErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	log.Error("writings.save", "err", err)
	return fp.OpErr("save writing", err)
}

// writingSaveErrClasses —— 保存这条路上**调用方给错了东西**的那几种。顺序无关
// (errors.Is 走 unwrap 链)。不在表里的一律当本机故障:记日志 + 500。
var writingSaveErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrWritingSlugTaken, func() error {
		return fp.Coded(fp.Conflict("a writing with this slug already exists"), "slug_taken")
	}},
	{entity.ErrParentNotFound, func() error {
		return fp.BadInput("parent writing not found")
	}},
	{entity.ErrParentCycle, func() error {
		return fp.BadInput("that parent would put the writing inside its own subtree")
	}},
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("slug and title are required")
	}},
}

func parseWritingCreate(raw json.RawMessage) (writingCreateArgs, error) {
	var args writingCreateArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := requireWritingSaveArgs(&args); err != nil {
		return args, err
	}
	applyWritingCreateDefaults(&args)
	return args, nil
}

// requireWritingSaveArgs —— **建和改的必填集不一样**。
//
// 建:slug + title —— 一篇新文章没有地址就无处安放。
// 改:只要 title —— 地址已经定了(而且是它的身份的一部分,不随手改),所以调用方
//
//	多半根本不带 slug。一律要 slug 的话,面板每次改标题都会拿到 400,
//	而错误信息说的是"缺 slug" —— 一个它从来就不该发的字段。
func requireWritingSaveArgs(args *writingCreateArgs) error {
	if args.WritingID == "" {
		return fp.RequireArgs(
			[2]string{"slug", args.Slug}, [2]string{"title", args.Title},
		)
	}
	return fp.RequireArgs([2]string{"title", args.Title})
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
		OwnerID: ownerID, WritingID: args.WritingID, Slug: args.Slug, Title: args.Title,
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
