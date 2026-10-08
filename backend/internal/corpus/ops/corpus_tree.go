// corpus_tree.go —— corpus.tree: one lazily loaded layer of a genre's tree (refactor ledger R9:
// the admin panel read the repos directly for this; it now reads it from the dispatcher).
//
// Panel-only: the tree is the panel's browsing shape, one layer per expanded node, so the full
// tree is never pulled at once. The owner's AI navigates with corpus.map instead. Each row is the
// one corpus item shape (corpusItemOut) plus has_children (can it be drilled into) and
// descendants (what a delete takes along, F-L-24); path is the server-slugified title chain.

package ops

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CorpusTree —— corpus.tree, and corpus.tags (the tag row above the panel's grid).
func CorpusTree(deps usecase.Deps) []fp.Op {
	return []fp.Op{
		{
			ID: "corpus.tree",
			Description: "One layer of a genre's tree: the children of parent (empty = the root " +
				"layer), each with has_children and descendants.",
			InputSchema: corpusTreeSchema, Kind: fp.Read,
			Reach:  fp.Only("the panel's lazy tree view; the AI uses corpus.map", "admin"),
			Invoke: treeCorpus(deps),
		},
		{
			ID:          "corpus.tags",
			Description: "Every tag the wiki has ever used ({tags}).",
			InputSchema: corpusTreeSchema, Kind: fp.Read,
			Reach:  fp.Only("the panel's tag row; corpus.list filters by tag for the AI", "admin"),
			Invoke: wikiTags(deps),
		},
	}
}

// wikiTags —— only the wiki has a tag row; any other genre is an unknown one here, as before.
func wikiTags(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Genre string `json:"genre"`
		}
		if err := json.Unmarshal(raw, &in); err != nil || in.Genre != genreWiki {
			return nil, fp.Coded(fp.NotFound("unknown corpus genre"), "unknown_genre")
		}
		tags, err := deps.Wiki.ListTags(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("wiki tags", err)
		}
		return json.Marshal(map[string][]string{"tags": tags})
	}
}

var corpusTreeSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
		"parent":{"type":"string","description":"Parent entry id; empty = the root layer."}
	},
	"required":["genre"]
}`)

func treeCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Genre  string `json:"genre"`
			Parent string `json:"parent"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := requireGenre(in.Genre); err != nil {
			return nil, fp.Coded(fp.NotFound("unknown corpus genre"), "unknown_genre")
		}
		items, err := treeByGenre(ctx, deps, ownerID, in.Genre, pathOrNil(in.Parent))
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(items)
	}
}

func treeByGenre(
	ctx context.Context, deps usecase.Deps, ownerID, genre string, parent *string,
) ([]corpusItemOut, error) {
	switch genre {
	case genreRaw:
		rows, err := deps.Raw.ListChildrenTree(ctx, ownerID, parent)
		return treeItems(rows, err, rawItem)
	case genreWiki:
		rows, err := deps.Wiki.ListChildrenTree(ctx, ownerID, parent)
		return treeItems(rows, err, wikiItem)
	case genreSubjectivity:
		rows, err := deps.Subjectivity.ListChildrenTree(ctx, ownerID, parent)
		return treeItems(rows, err, subjectivityPathItem)
	default:
		rows, err := deps.Output.ListChildrenTree(ctx, ownerID, parent)
		return treeItems(rows, err, outputItem)
	}
}

// treeItems —— one tree layer as items, with the drill-down flag and the descendant count.
func treeItems[T listedEntry](
	rows []repo.TreeChild[T], err error, toItem func(*T, string) corpusItemOut,
) ([]corpusItemOut, error) {
	if err != nil {
		return nil, fmt.Errorf("tree layer: %w", err)
	}
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		item := toItem(&rows[i].Entry, usecase.PathFromTitles(rows[i].PathTitles))
		item.HasChildren, item.Descendants = rows[i].HasChildren, rows[i].Descendants
		out = append(out, item)
	}
	return out, nil
}
