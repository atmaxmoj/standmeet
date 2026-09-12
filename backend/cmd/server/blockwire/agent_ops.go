// agent_ops.go —— `suppliers.agent_ops`: for each supplier that's connected and
// has "expose to visitor AI" turned on, which operations can be granted.
//
// **Why this exists** (F-C-57): the checkbox on the assembly screen reads *"Let a
// visitor's AI call these operations directly … subject to per-code grants"*, but the
// session-side gate checks whether `op_<id>` is present in the `allowed_tools` of the
// skill attached to that role. In other words, checking the box still leaves a
// granting step, and to complete that step the owner first has to know **what these
// operations are named** — the product had never said, until now.
//
// Making the owner hand-type `op_gists_list` from vendor docs doesn't count as
// "said": that name is normalized by the product itself (`agent_tool_name.go`) —
// the string doesn't exist anywhere in the vendor's documentation.

package blockwire

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// agentOpOut —— one grantable operation: its tool name + its own description line.
type agentOpOut struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// agentOpsRowOut —— one supplier + the operations it exposes.
// Carries title/seam because a single vendor's docs can list a thousand ops —
// unreadable without saying whose they are.
type agentOpsRowOut struct {
	BlockID string       `json:"block_id"`
	Title   string       `json:"title,omitempty"`
	Seam    string       `json:"seam,omitempty"`
	Ops     []agentOpOut `json:"ops"`
}

func agentOpsList(ops supplierOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		conns, err := ops.svc.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list suppliers", err)
		}
		return json.Marshal(agentOpsRows(ops, conns))
	}
}

// agentOpsRows —— the connected ones → each one's op list. **Unconnected ones are
// not listed**: a supplier that can't be reached can't be called even if granted, so
// putting it in the picker would just invite the owner to grant a permission that
// never takes effect.
func agentOpsRows(ops supplierOps, conns []credentials.Connection) []agentOpsRowOut {
	byID := ops.sups.AgentOpsByID(connectedIDsOf(conns))
	rows := make([]agentOpsRowOut, 0, len(byID))
	for i := range conns {
		list, has := byID[conns[i].BlockID]
		if !has {
			continue
		}
		rows = append(rows, agentOpsRowOut{
			BlockID: conns[i].BlockID,
			Title:   conns[i].Title,
			Seam:    conns[i].Seam,
			Ops:     toAgentOpOuts(list),
		})
	}
	return rows
}

func connectedIDsOf(conns []credentials.Connection) []string {
	out := make([]string, 0, len(conns))
	for i := range conns {
		if conns[i].Connected {
			out = append(out, conns[i].BlockID)
		}
	}
	return out
}

func toAgentOpOuts(list []adapters.AgentOpView) []agentOpOut {
	out := make([]agentOpOut, 0, len(list))
	for i := range list {
		out = append(out, agentOpOut{Name: list[i].Name, Description: list[i].Description})
	}
	return out
}
