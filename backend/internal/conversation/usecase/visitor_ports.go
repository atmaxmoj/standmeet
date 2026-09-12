// visitor_ports.go —— narrow assembly ports (consumer-side) that the visitor agent loop
// consumes. Satisfied structurally by whatever the composition root injects, so
// conversation never depends back on the assembly layer.

package usecase

import (
	"context"
	"encoding/json"
)

// AgentOp —— metadata for one operation a block exposes as an agent tool.
type AgentOp struct {
	Name        string // op_<operationId> (dots -> underscores; D-3 snake_case)
	OpID        string // the original operationId, used at call time
	Description string // fed to the model so it can pick
}

// AgentToolSource —— a block that exposes its own operations as agent tools.
//
// This interface used to live beside the supplier consumers, one package over from the
// typed `contract.CalendarProxy` family that the block model deletes. It survived the
// deletion untouched because it was already the right shape: a NAME and opaque JSON,
// with credentials resolved inside the block and never handed to the caller. The
// typed proxies beside it are what could not survive.
//
// It lives here now because the consumer is the party that knows what it needs.
type AgentToolSource interface {
	ExposesAgentTools() bool
	AgentOps() []AgentOp
	CallAgentOp(
		ctx context.Context, ownerID, opID string, argsJSON json.RawMessage,
	) (json.RawMessage, error)
}

// AgentToolSupplierSource —— fetches the owner's agent-tool blocks (used to assemble the
// openapi-backed tools).
type AgentToolSupplierSource interface {
	AgentToolSources(ctx context.Context, ownerID string) ([]AgentToolSource, error)
}

// DepConnected —— whether the named seam dependencies are all connected (the
// ext-mcp dep-grant gate).
type DepConnected interface {
	AllConnected(ctx context.Context, ownerID string, deps []string) (bool, error)
}

// ResumeSource —— fetches "this" application's resume content (JSON) by the session's
// access code. err != nil = couldn't fetch (an ordinary code with no bound application,
// or a real failure); the visitor-side resume-reading block fail-closed hides
// itself based on this either way —— it never needs to tell "not there" apart from
// "broken." Used at assembly time.
type ResumeSource interface {
	ResumeForCode(ctx context.Context, ownerID, codeID string) ([]byte, error)
}
