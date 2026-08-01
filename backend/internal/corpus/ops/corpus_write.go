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
			Description: "Delete a corpus entry. A raw entry is archived (it is the record of " +
				"what was dumped); wiki, output and subjectivity entries are deleted.",
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
			"genre":{"type":"string","description":"'raw' | 'wiki' | 'output'."},
			"title":{"type":"string","description":"Title (wiki / output; raw has none)."},
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
			"genre":{"type":"string","description":"'raw' | 'wiki' | 'output'."},
			"id":{"type":"string","description":"Entry id."},
			"title":{"type":"string","description":"Title (wiki / output)."},
			"body":{"type":"string","description":"Markdown body."},
			"parent_id":{"type":"string","description":"Parent entry id; root if empty."},
			"tags":{"type":"array","items":{"type":"string"},"description":"Tags."},
			"css_classes":{"type":"array","items":{"type":"string"},
				"description":"wiki only: per-note presentation classes."},
			"show_as_source":{"type":"boolean",
				"description":"false = the AI may read it but never cites it."},
			"flagged_private":{"type":"boolean","description":"raw only: private hint."}
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
				"description":"Extra tags on top of the source's."}
		},
		"required":["genre","id","title"]
	}`)
)

// corpusWriteArgs —— 建和改共用的入参。哪些字段对哪个 genre 有意义,由下面的分派决定。
type corpusWriteArgs struct {
	Genre          string   `json:"genre"`
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Body           string   `json:"body"`
	ParentID       string   `json:"parent_id"`
	Source         string   `json:"source"`
	Tags           []string `json:"tags"`
	CSSClasses     []string `json:"css_classes"`
	ShowAsSource   bool     `json:"show_as_source"`
	FlaggedPrivate bool     `json:"flagged_private"`
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

func updateCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusWrite(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		item, err := updateByGenre(ctx, deps, ownerID, &in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(item)
	}
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
	case genreWiki:
		row, err := usecase.UpdateWiki(ctx, deps, &usecase.UpdateWikiReq{
			OwnerID: ownerID, ID: in.ID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
			ShowAsSource: in.ShowAsSource, CSSClasses: in.CSSClasses,
		})
		return wikiItem(&row, ""), err
	default:
		row, err := usecase.UpdateOutput(ctx, deps, &usecase.UpdateOutputReq{
			OwnerID: ownerID, ID: in.ID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
			ShowAsSource: in.ShowAsSource,
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

func deleteCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusDelete(raw)
		if perr != nil {
			return nil, perr
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
	if in.Genre != genreSubjectivity {
		if err := requireGenre(in.Genre); err != nil {
			return in, err
		}
	}
	return in, fp.RequireArgs([2]string{"id", in.ID})
}

func deleteByGenre(
	ctx context.Context, deps usecase.Deps, ownerID, genre, id string,
) error {
	switch genre {
	case genreRaw:
		return usecase.ArchiveRaw(ctx, deps, ownerID, id)
	case genreWiki:
		return usecase.DeleteWiki(ctx, deps, ownerID, id)
	case genreSubjectivity:
		return usecase.DeleteSubjectivity(ctx, deps, ownerID, id)
	default:
		return usecase.DeleteOutput(ctx, deps, ownerID, id)
	}
}

func promoteCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusWrite(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs(
			[2]string{"id", in.ID}, [2]string{"title", in.Title}); err != nil {
			return nil, err
		}
		item, err := promoteByGenre(ctx, deps, ownerID, &in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(item)
	}
}

func promoteByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	if in.Genre == genreRaw {
		row, err := usecase.PromoteToWiki(ctx, deps, &usecase.PromoteInput{
			OwnerID: ownerID, RawID: in.ID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Tags: in.Tags,
		})
		if err != nil {
			return corpusItemOut{}, err
		}
		return wikiItem(&row, entryPath(ctx, deps, genreWiki, ownerID, row.ID())), nil
	}
	if in.Genre == genreOutput {
		return corpusItemOut{}, fp.BadInput("output is the last step; nothing to promote it to")
	}
	row, err := usecase.PromoteWikiToOutput(ctx, deps, &usecase.PromoteToOutputInput{
		OwnerID: ownerID, WikiID: in.ID, ParentID: parentOrNil(in.ParentID),
		Title: in.Title, Tags: in.Tags,
	})
	if err != nil {
		return corpusItemOut{}, err
	}
	return outputItem(&row, entryPath(ctx, deps, genreOutput, ownerID, row.ID())), nil
}
