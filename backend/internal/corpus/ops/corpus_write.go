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
				"show_as_source switch. Omitted fields are replaced, so send the whole entry — " +
				"except parent_id and the cover_* fields, which are left alone when omitted " +
				"(omitting a parent must not move the note, because its address is its parent).",
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
			"parent_id":{"type":"string",
				"description":"Parent id. OMIT to leave it put; '' moves it to the root."},
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

// 入参的形状 + 每个字段「没给」是什么意思,都在 corpus_write_args.go。

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
			Tags: in.Tags, FlaggedPrivate: in.flaggedPrivate(),
		})
		return rawItem(&row, ""), err
	case genreSubjectivity:
		return writeSubjectivityEntry(ctx, deps, ownerID, in, parentOrNil(in.ParentID))
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
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs, parent *string,
) (corpusItemOut, error) {
	res, err := usecase.WriteSubjectivity(ctx, deps, &usecase.WriteSubjectivityInput{
		OwnerID: ownerID, ID: in.ID, Title: in.Title, Body: in.Body,
		Tags: in.Tags, CSSClasses: in.CSSClasses,
		ParentID:     parent,
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
	if in.Genre == genreRaw {
		flagged, ferr := keptFlaggedPrivate(ctx, deps, ownerID, in)
		if ferr != nil {
			return corpusItemOut{}, ferr
		}
		tags, terr := keptTags(ctx, deps, ownerID, in)
		if terr != nil {
			return corpusItemOut{}, terr
		}
		row, err := usecase.UpdateRaw(ctx, deps, &usecase.UpdateRawReq{
			OwnerID: ownerID, ID: in.ID, Body: in.Body,
			Tags: tags, FlaggedPrivate: flagged,
		})
		return rawItem(&row, ""), err
	}
	// raw 没有父级(它不成树),其余三个 genre 都要先把「没给 = 不动」解析成具体的父级。
	parent, err := keptParentID(ctx, deps, ownerID, in)
	if err != nil {
		return corpusItemOut{}, err
	}
	return updateTreeGenre(ctx, deps, ownerID, in, parent)
}

func updateTreeGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs, parent *string,
) (corpusItemOut, error) {
	if in.Genre == genreSubjectivity {
		return writeSubjectivityEntry(ctx, deps, ownerID, in, parent)
	}
	// tags / css_classes 也走「没给 = 不动」—— 三个 genre 一起,不再只修撞到的那一个。
	tags, terr := keptTags(ctx, deps, ownerID, in)
	if terr != nil {
		return corpusItemOut{}, terr
	}
	if in.Genre == genreWiki {
		classes, cerr := keptCSSClasses(ctx, deps, ownerID, in)
		if cerr != nil {
			return corpusItemOut{}, cerr
		}
		row, err := usecase.UpdateWiki(ctx, deps, &usecase.UpdateWikiReq{
			OwnerID: ownerID, ID: in.ID, ParentID: parent,
			Title: in.Title, Body: in.Body, Tags: tags,
			ShowAsSource: in.showAsSource(), CSSClasses: classes,
		})
		return wikiItem(&row, ""), err
	}
	row, err := usecase.UpdateOutput(ctx, deps, &usecase.UpdateOutputReq{
		OwnerID: ownerID, ID: in.ID, ParentID: parent,
		Title: in.Title, Body: in.Body, Tags: tags,
		ShowAsSource: in.showAsSource(),
	})
	return outputItem(&row, ""), err
}

// deletedOut —— 删的回执。
type deletedOut struct {
	Genre   string `json:"genre"`
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}
