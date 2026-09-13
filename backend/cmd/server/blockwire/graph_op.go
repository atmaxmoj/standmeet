// graph_op.go — the owner-read block dependency graph (the fiber view's data layer).
//
// The fiber view draws the composition and locks a block's Active toggle while something relies on
// it; both need the graph — each block's provides/requires and, crucially, what relies on it
// (RequiredBy). This op returns that over the owner's current set (builtins + installed), computed
// host-side by plugin.Graph. Read-only; the write side (install/cycle-refusal) lives elsewhere.

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// graphOut — the read shape: the dependency graph nodes. Named struct (any is banned; shape fixed).
type graphOut struct {
	Nodes []plugin.GraphNode `json:"nodes"`
}

// blockGraphOp — the "blocks.graph" op: the owner's block dependency graph.
func blockGraphOp(d *deps.Runtime) fp.Op {
	return fp.Op{
		ID: "blocks.graph",
		Description: "The block dependency graph: each block's provides / requires, and what " +
			"relies on it (required_by). The fiber view draws this and locks a block's Active " +
			"toggle while something relies on it.",
		InputSchema: fp.NoArgs,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      blockGraph(d),
	}
}

func blockGraph(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		nodes := plugin.Graph(currentManifestSet(ctx, d, ownerID))
		out, err := json.Marshal(graphOut{Nodes: nodes})
		if err != nil {
			return nil, fmt.Errorf("marshal block graph: %w", err)
		}
		return out, nil
	}
}
