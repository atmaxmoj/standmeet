// seam_agenttools.go -- the **consumer contract** for a supplier's raw operations: the types
// non-supplier code (the kernel's openapi-agent-tools wiring surface, owner tools, admin routes)
// depends on -- the agent-tool supplier interface + the mail-not-configured error.
//
// Keeping these here, next to the suppliers rather than inside a consumer, serves two purposes:
//   - consumers don't have to import a supplier **implementation** -> kills the reverse
//     dependency into usecases;
//   - there is **no** typed seam proxy here (CalendarProxy stays with its own seam), so the
//     kernel importing this still can't reach a typed seam surface -- #135's "zero typed seam
//     surface in the kernel" lock stays intact.

package adapters

import (
	"context"
	"encoding/json"
	"errors"
)

// ErrMailNotConfigured -- the owner hasn't configured / verified a mail supplier yet, so mail
// can't be sent.
// sibling: ErrCalendarNotConnected (the calendar side's equivalent sentinel).
var ErrMailNotConfigured = errors.New("mail supplier not configured")

// AgentOp -- metadata for an openapi operation exposed as an agent tool.
type AgentOp struct {
	Name        string // op_<operationId> (dots -> underscores; D-3 snake_case)
	OpID        string // the original operationId (used at runtime to call the SaaS)
	Description string // operation summary (falls back to description) -- fed to the LLM to pick
}

// AgentToolSupplier -- a supplier that exposes its own raw operations as agent tools (currently
// openapi only).
// Credential/auth injection all happens inside the supplier (CallAgentOp decrypts and injects
// internally); the consumer only passes ownerID + opID + args.
type AgentToolSupplier interface {
	ExposesAgentTools() bool
	AgentOps() []AgentOp
	CallAgentOp(
		ctx context.Context, ownerID, opID string, argsJSON json.RawMessage,
	) (json.RawMessage, error)
}
