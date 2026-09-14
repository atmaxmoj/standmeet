// supplier_agent_tools.go —— the owner's connected, opted-in suppliers seen as visitor agent tools.
// Split out of supplier_register.go: the bridge from the adapters supplier port to the conversation
// domain's agent-tool port is its own concern (the composition root introduces the two sides).

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// AgentToolSuppliers —— the owner's opted-in, connected suppliers, for visitor use.
type AgentToolSuppliers struct {
	repo *credentials.Repo
	sups *adapters.Suppliers
}

// NewAgentToolSuppliers —— the owner's connected suppliers that are opted in as agent tools.
func NewAgentToolSuppliers(d *deps.Runtime) *AgentToolSuppliers {
	return &AgentToolSuppliers{repo: d.Credentials, sups: d.BlockSuppliers}
}

// AgentToolSources —— the suppliers the owner has connected and opted in as agent tools.
func (s *AgentToolSuppliers) AgentToolSources(
	ctx context.Context, ownerID string,
) ([]conversation.AgentToolSource, error) {
	conns, err := s.repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list suppliers for agent tools: %w", err)
	}
	// Widen to the port the consumer declared. The two interfaces have the same
	// methods and different owners on purpose: conversation names what it needs,
	// adapters names what a supplier offers, and neither imports the other. The
	// composition root is where they meet, so the loop is here and not in a shared
	// type both would have had to agree on.
	sups := s.sups.AgentToolSuppliersByID(connectedIDs(conns))
	out := make([]conversation.AgentToolSource, 0, len(sups))
	for _, sup := range sups {
		out = append(out, agentToolBridge{sup})
	}
	return out, nil
}

// agentToolBridge —— one supplier, seen as the port conversation declared.
//
// The two interfaces have the same three methods and differ only in whose `AgentOp`
// they name. That is not duplication to be collapsed: conversation states what a
// consumer needs, adapters states what a supplier offers, and neither importing the
// other is what lets either change without the other recompiling. The composition root
// is where they are introduced, so the translation is four lines here rather than a
// shared package both would have to agree on.
type agentToolBridge struct{ sup adapters.AgentToolSupplier }

func (b agentToolBridge) ExposesAgentTools() bool { return b.sup.ExposesAgentTools() }

func (b agentToolBridge) CallAgentOp(
	ctx context.Context, ownerID, opID string, args json.RawMessage,
) (json.RawMessage, error) {
	return b.sup.CallAgentOp(ctx, ownerID, opID, args)
}

func (b agentToolBridge) AgentOps() []conversation.AgentOp {
	ops := b.sup.AgentOps()
	out := make([]conversation.AgentOp, 0, len(ops))
	for i := range ops {
		out = append(out, conversation.AgentOp{
			Name: ops[i].Name, OpID: ops[i].OpID, Description: ops[i].Description,
		})
	}
	return out
}

// connectedIDs —— ids of connected suppliers (agent-tools gate: unconnected is never exposed).
func connectedIDs(conns []credentials.Connection) []string {
	out := make([]string, 0, len(conns))
	for i := range conns {
		if conns[i].Connected {
			out = append(out, conns[i].BlockID)
		}
	}
	return out
}
