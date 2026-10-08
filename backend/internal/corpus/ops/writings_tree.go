// writings_tree.go —— writings.tree: one lazily loaded layer of the writings tree (refactor ledger
// R9: the admin panel read the repo directly for this). Panel-only, like corpus.tree; each row is
// the full writing record (writingOut) plus has_children.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func writingsTreeOp(deps WritingsDeps) fp.Op {
	return fp.Op{
		ID:          "writings.tree",
		Description: "One layer of the writings tree: the children of parent (empty = the root).",
		InputSchema: writingsTreeSchema, Kind: fp.Read,
		Reach:  fp.Only("the panel's lazy tree view; writings.list serves the AI", "admin"),
		Invoke: treeWritings(deps),
	}
}

var writingsTreeSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"parent":{"type":"string","description":"Parent id; empty = the root layer."}}
}`)

func treeWritings(deps WritingsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Parent string `json:"parent"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		rows, err := deps.Writings.Writings.ListChildrenTree(ctx, ownerID, pathOrNil(in.Parent))
		if err != nil {
			return nil, fp.OpErr("writings tree", err)
		}
		out := make([]writingOut, 0, len(rows))
		for i := range rows {
			v := deps.toWritingOut(ctx, &rows[i].Entry)
			v.HasChildren = rows[i].HasChildren
			out = append(out, v)
		}
		return json.Marshal(out)
	}
}
