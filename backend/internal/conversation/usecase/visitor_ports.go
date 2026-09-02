// visitor_ports.go —— narrow capability-assembly ports (consumer-side) that the visitor
// agent loop consumes. Structurally satisfied by capreg glue's concrete implementations;
// injected by the composition root. Structural duals of the same-named ports in
// usecases/capreg_*, so conversation never depends back on capreg glue.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
)

// AgentConnectorSource —— fetches the owner's agent-tool connector list (used to
// assemble the openapi capability).
type AgentConnectorSource interface {
	AgentConnectors(ctx context.Context, ownerID string) ([]consumer.AgentToolConnector, error)
}

// DepConnected —— whether the named connector dependencies are all connected (the
// ext-mcp dep-grant gate).
type DepConnected interface {
	AllConnected(ctx context.Context, ownerID string, deps []string) (bool, error)
}

// ResumeSource —— fetches "this" application's resume content (JSON) by the session's
// access code. err != nil = couldn't fetch (an ordinary code with no bound application,
// or a real failure); the visitor-side resume-reading capability fail-closed hides
// itself based on this either way —— it never needs to tell "not there" apart from
// "broken." Used at assembly time.
type ResumeSource interface {
	ResumeForCode(ctx context.Context, ownerID, codeID string) ([]byte, error)
}
