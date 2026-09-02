// Package consumer -- the connector axis's **consumer contract**: connector-axis types that
// non-connector code (the kernel's openapi-agent-tools wiring surface, owner tools, admin routes)
// depends on -- the agent-tool connector interface + the mail-not-configured error.
//
// Putting this in its own leaf package (not in the internal/connector implementation package, and
// not in the contract package either) serves two purposes:
//   - consumers don't have to import the connector **implementation** package -> kills the
//     connector->usecases reverse dependency;
//   - there is **no** typed category proxy here (CalendarProxy stays in contract), so the kernel
//     importing this package still can't reach the category surface -- #135's "zero typed
//     category surface in the kernel" lock stays intact.
package consumer

import (
	"context"
	"encoding/json"
	"errors"
)

// ErrMailNotConfigured -- the owner hasn't configured / verified a mail connector yet, so mail
// can't be sent.
// sibling: contract.ErrCalendarNotConnected (the calendar side's equivalent sentinel).
var ErrMailNotConfigured = errors.New("mail connector not configured")

// AgentOp -- metadata for an openapi operation exposed as an agent tool.
type AgentOp struct {
	Name        string // op_<operationId> (dots -> underscores; D-3 snake_case)
	OpID        string // the original operationId (used at runtime to call the SaaS)
	Description string // operation summary (falls back to description) -- fed to the LLM to pick
}

// AgentToolConnector -- a connector that exposes its own raw operations as agent tools (currently
// openapi only).
// Credential/auth injection all happens inside the connector (CallAgentOp decrypts and injects
// internally); the consumer only passes ownerID + opID + args.
type AgentToolConnector interface {
	ExposesAgentTools() bool
	AgentOps() []AgentOp
	CallAgentOp(
		ctx context.Context, ownerID, opID string, argsJSON json.RawMessage,
	) (json.RawMessage, error)
}
