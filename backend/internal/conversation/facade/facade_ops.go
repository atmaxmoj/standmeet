// facade_ops.go -- the things this domain can do outward, re-exported for convergence.
//
// Still just a facade: aliases only. Declared in internal/conversation/ops.

package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/ops"

// Types needed to declare ops (impl: ops).
type (
	OpsConversations = ops.ConversationsDeps
	// OpsHost -- the deps bundle for the inbound (sandbox calling back to the host) items.
	OpsHost = ops.HostDeps
)

// Op groups (impl: ops).
var (
	ConversationOps = ops.Conversations
	// HostOps -- exposed to sandboxed capabilities: read transcript / borrow the LLM to
	// generate / store a report.
	HostOps = ops.HostOps
)
