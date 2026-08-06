// corpus_write.go —— 语料的写:建 / 改 / 删 / 提升(声明在 corpus.go)。
//
// genre 是参数,不是三套工具。归一化前这四件事在两个面上覆盖不一样:面板能建 wiki 和
// output、能改 raw,MCP 只有 raw_dump / update_wiki / update_output / delete_wiki /
// delete_output / promote_*。也就是说 owner 从 Claude Code **建不了一条 wiki、改不了一条
// raw** —— 那不是设计,是没人补的格子。genre 参数化之后,缺的格子由结构自动补齐。
//
// 提升是有方向的:raw → wiki → output。所以 corpus.promote 的 genre 说的是**源**的 genre。

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CorpusWrites —— create / update / delete / promote。
func CorpusWrites(deps usecase.Deps) []fp.Op {
	return []fp.Op{
		{
			ID: "corpus.create",
			Description: "Create a corpus entry. genre 'raw' takes a body (a rough dump, no " +
				"title); 'wiki' and 'output' take a title plus body, and their address is " +
				"derived from the title and the tree — never set by hand.",
			InputSchema: corpusCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createCorpus(deps),
		},
		{
			ID: "corpus.update",
			Description: "Update a corpus entry in place: body, tags, title, parent, and the " +
				"show_as_source switch. Omitted fields are replaced, so send the whole entry.",
			InputSchema: corpusUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateCorpus(deps),
		},
		{
			ID: "corpus.delete",
			Description: "Delete a corpus entry of any genre (raw / wiki / output / " +
				"subjectivity), along with the files attached to it. This cannot be undone.",
			InputSchema: corpusGetSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteCorpus(deps),
		},
		{
			ID: "corpus.promote",
			Description: "Promote an entry one step along raw → wiki → output: genre names the " +
				"SOURCE. The new entry records where it came from, and inherits the source's " +
				"tags on top of any given here.",
			InputSchema: corpusPromoteSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promoteCorpus(deps),
		},
	}
}

var (
	corpusCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
			"title":{"type":"string","description":"Title (raw has none)."},
			"body":{"type":"string","description":"Markdown body."},
			"parent_id":{"type":"string","description":"Parent entry id; root if empty."},
			"tags":{"type":"array","items":{"type":"string"},"description":"Tags."},
			"source":{"type":"string",
				"description":"raw only: where it came from (e.g. mcp:claude-desktop)."},
			"flagged_private":{"type":"boolean","description":"raw only: private hint."}
		},
		"required":["genre","body"]
	}`)

	corpusUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
			"id":{"type":"string","description":"Entry id."},
			"title":{"type":"string","description":"Title (wiki / output)."},
			"body":{"type":"string","description":"Markdown body."},
			"parent_id":{"type":"string","description":"Parent entry id; root if empty."},
			"tags":{"type":"array","items":{"type":"string"},"description":"Tags."},
			"css_classes":{"type":"array","items":{"type":"string"},
				"description":"wiki only: per-note presentation classes."},
			"show_as_source":{"type":"boolean",
				"description":"false = the AI may read it but never cites it."},
			"flagged_private":{"type":"boolean","description":"raw only: private hint."},
			"cover_image_asset_id":{"type":"string",
				"description":"Hero image: an asset_id from assets.upload; '' clears it."},
			"cover_headline":{"type":"string","description":"The line laid over the hero image."},
			"cover_hue":{"type":"string","description":"Hero hue: 'amber' | 'violet' | 'acid'."}
		},
		"required":["genre","id"]
	}`)

	corpusPromoteSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"SOURCE genre: 'raw' (→ wiki) or 'wiki' (→ output)."},
			"id":{"type":"string","description":"Source entry id."},
			"title":{"type":"string","description":"Title of the new entry."},
			"parent_id":{"type":"string","description":"Parent for the new entry; root if empty."},
			"tags":{"type":"array","items":{"type":"string"},
				"description":"Extra tags on top of the source's."},
			"show_as_source":{"type":"boolean",
				"description":"false = readable by the AI but never cited. Default true."}
		},
		"required":["genre","id","title"]
	}`)
)

// corpusWriteArgs —— 建和改共用的入参。哪些字段对哪个 genre 有意义,由下面的分派决定。
//
// hero 三项是**指针**:没给 = 不动,不是"清空"。其余字段整份替换(见 corpus.update 的说明),
// 但 hero 不能跟着那个规矩 —— 既有调用方一个 hero 字段都不带,那样每次改正文都会把 owner
// 设好的 hero 抹掉。
type corpusWriteArgs struct {
	CoverImageAssetID *string  `json:"cover_image_asset_id"`
	CoverHeadline     *string  `json:"cover_headline"`
	CoverHue          *string  `json:"cover_hue"`
	Genre             string   `json:"genre"`
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	Body              string   `json:"body"`
	ParentID          string   `json:"parent_id"`
	Source            string   `json:"source"`
	ShowAsSource      *bool    `json:"show_as_source"`
	Tags              []string `json:"tags"`
	CSSClasses        []string `json:"css_classes"`
	FlaggedPrivate    bool     `json:"flagged_private"`
}

// showAsSource —— 没给就是 true。
//
// **这是个契约,不是默认值的选择**:一条语料建出来就是可引用的来源;藏起来(meta/persona 那类)
// 是 owner 明确要求的例外。genre 参数化之前这里是 `args.ShowAsSource == nil || *args.ShowAsSource`,
// 参数化时被写成了一个裸 bool —— 于是"没提到这个字段"从"保持可引用"变成了"藏起来",
// 而且编译不报、改口的人也看不见。裸 bool 表达不了"没给",所以它不该是 bool。
func (a *corpusWriteArgs) showAsSource() bool {
	return a.ShowAsSource == nil || *a.ShowAsSource
}

func decodeCorpusWrite(raw json.RawMessage) (corpusWriteArgs, error) {
	var in corpusWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, requireGenre(in.Genre)
}

// parentOrNil —— 空 = 挂在根上,不是错。
func parentOrNil(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

// defaultSource —— raw 没说来源就记 "mcp"(它绝大多数从 owner 的 AI 客户端来);
// 面板那条会自己带 "admin"。
func defaultSource(s string) string {
	if s == "" {
		return "mcp"
	}
	return s
}

func createCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusWrite(raw)
		if perr != nil {
			return nil, perr
		}
		// 多语结构坏了就别落库:读者那侧的症状是"少了半篇",而且没有任何提示。
		if gerr := guardI18n(in.Body); gerr != nil {
			return nil, gerr
		}
		item, err := createByGenre(ctx, deps, ownerID, &in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(item)
	}
}

func createByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		row, err := usecase.RawDump(ctx, deps, &usecase.RawDumpInput{
			OwnerID: ownerID, Body: in.Body, Source: defaultSource(in.Source),
			Tags: in.Tags, FlaggedPrivate: in.FlaggedPrivate,
		})
		return rawItem(&row, ""), err
	case genreSubjectivity:
		return writeSubjectivityEntry(ctx, deps, ownerID, in)
	case genreWiki:
		row, err := usecase.CreateWiki(ctx, deps, &usecase.CreateWikiReq{
			OwnerID: ownerID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
		})
		return wikiItem(&row, ""), err
	default:
		row, err := usecase.CreateOutput(ctx, deps, &usecase.CreateOutputReq{
			OwnerID: ownerID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
		})
		return outputItem(&row, ""), err
	}
}

// checkUpdatable —— 改一条之前的两道:必填的 id,以及正文的多语结构。
func checkUpdatable(in *corpusWriteArgs) error {
	if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
		return err
	}
	return guardI18n(in.Body)
}

func updateCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusWrite(raw)
		if perr != nil {
			return nil, perr
		}
		if err := checkUpdatable(&in); err != nil {
			return nil, err
		}
		item, err := applyCorpusUpdate(ctx, deps, ownerID, &in)
		if err != nil {
			return nil, corpusErr(err)
		}
		fillMedia(ctx, deps, ownerID, in.ID, &item)
		return json.Marshal(item)
	}
}

// writeSubjectivityEntry —— corpus.create / corpus.update 上的第四个 genre。
//
// 建和改是**同一条**(WriteSubjectivity:给了 id 就是改),所以两处分派都进这里。
//
// 为什么不让面板去打 subjectivity_write:面板发的是 `/corpus/{genre}`,genre 是参数。
// 让它对 subjectivity 换一个 endpoint,等于每个 corpus 组件都要认一个特例 —— 而这个
// genre 加进来的时候就写明了"它不是特例,只是第五个 genre"。subjectivity_write 那个名字
// 留着:owner 的 AI 一直在用它(CLAUDE.md 里也写着),两条打的是同一个 usecase。
func writeSubjectivityEntry(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	res, err := usecase.WriteSubjectivity(ctx, deps, &usecase.WriteSubjectivityInput{
		OwnerID: ownerID, ID: in.ID, Title: in.Title, Body: in.Body,
		Tags: in.Tags, CSSClasses: in.CSSClasses,
		ParentID:     parentOrNil(in.ParentID),
		ShowAsSource: in.showAsSource(),
	})
	if err != nil {
		return corpusItemOut{}, err
	}
	return getSubjectivityItem(ctx, deps, ownerID, res.ID)
}

func updateByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		row, err := usecase.UpdateRaw(ctx, deps, &usecase.UpdateRawReq{
			OwnerID: ownerID, ID: in.ID, Body: in.Body,
			Tags: in.Tags, FlaggedPrivate: in.FlaggedPrivate,
		})
		return rawItem(&row, ""), err
	case genreSubjectivity:
		return writeSubjectivityEntry(ctx, deps, ownerID, in)
	case genreWiki:
		row, err := usecase.UpdateWiki(ctx, deps, &usecase.UpdateWikiReq{
			OwnerID: ownerID, ID: in.ID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
			ShowAsSource: in.showAsSource(), CSSClasses: in.CSSClasses,
		})
		return wikiItem(&row, ""), err
	default:
		row, err := usecase.UpdateOutput(ctx, deps, &usecase.UpdateOutputReq{
			OwnerID: ownerID, ID: in.ID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
			ShowAsSource: in.showAsSource(),
		})
		return outputItem(&row, ""), err
	}
}

// deletedOut —— 删的回执。
type deletedOut struct {
	Genre   string `json:"genre"`
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}
