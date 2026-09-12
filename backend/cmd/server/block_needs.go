// block_needs.go —— the two halves of the marketplace card's "which supplier is
// still needed" line, joined together at the composition root (F-F-4).
//
// A skill declares which **tools** it uses (SKILL.md's `allowed-tools`); a block
// declares which **seams** it needs (the manifest's `requires`); which seams
// the owner has actually supplied lives on the supplier side. The marketplace domain
// knows none of these three, so it only declares one port (`SeamNeeds`), and this
// file wires the three together:
//
//	allowed-tools ─▶ block registry (who provides this tool, what it needs) ─▶
//	suppliers (connected or not)
//
// Why it lives at the root: this chain crosses three places that shouldn't know about
// each other. Same shape as mcp_probe.go — the domain asks a question, the root
// answers with parts already on hand.
//
// Why it holds Runtime instead of the two tables directly: both tables are only built
// inside `registerAgentSkills`, and the outbound convergence point is assembled before
// that. Holding Runtime means fetching them only **when actually invoked**, by which
// point both tables are complete.

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// seamNeeds —— implementation of marketplace.SeamNeeds.
type seamNeeds struct {
	rt *deps.Runtime
}

// DepsForTools —— which seams these tools need behind the scenes. The registry
// only recognizes blocks that **declared their own tool names** (the manifest's
// `visitor_tools`); an unrecognized one returns empty — that means "this table doesn't
// know it", and callers should leave that skill's needs as nil (unknown), not []
// (nothing needed).
func (n *seamNeeds) DepsForTools(tools []string) []string {
	if n.rt.AgentSkills == nil || len(tools) == 0 {
		return []string{}
	}
	return n.rt.AgentSkills.DepsForTools(tools)
}

// Unconnected —— of these seams, the ones this owner has not supplied yet.
func (n *seamNeeds) Unconnected(
	ctx context.Context, ownerID string, names []string,
) ([]string, error) {
	if n.rt.DepRegistry == nil || len(names) == 0 {
		return []string{}, nil
	}
	out, err := n.rt.DepRegistry.Unconnected(ctx, ownerID, names)
	if err != nil {
		return nil, fmt.Errorf("unconnected deps: %w", err)
	}
	return out, nil
}
