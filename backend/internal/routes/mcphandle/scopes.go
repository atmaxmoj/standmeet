// scopes.go —— a key reaches only the tools its scopes cover (refactor ledger R7), and, when it
// names some, only those tools (job-loop roadmap 8.5.a).
//
// Every tool on this face has a danger class: a dispatcher op's is DangerOf() (R8), a registry
// binding's is the class it declares. A key's scopes are the classes it may use; its tool list,
// when not empty, narrows further to named tools. tools/list shows only the tools in reach, and a
// call out of reach is refused with what it needed — the listing keeps an honest client from
// trying, the refusal stops one that tries anyway.

package mcphandle

import (
	"context"
	"slices"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

var ctxKeyScopes = ctxKey{name: "mcpScopes"}

// keyLimits —— what the verified key may reach: its classes, and its tool list (empty = any).
type keyLimits struct {
	scopes []string
	tools  []string
}

// toolDangers —— tool name → its danger class, filled as the tools are registered. A tool that
// declares no class is reachable by a key with every class only.
type toolDangers map[string]string

// classAllowed —— whether a key with these scopes may use a tool of this class.
func classAllowed(scopes []string, danger string) bool {
	if danger == "" {
		return len(scopes) == len(fp.AllDangers())
	}
	return slices.Contains(scopes, danger)
}

// listed —— whether the key's tool list lets this tool through.
func (l keyLimits) listed(tool string) bool {
	return len(l.tools) == 0 || slices.Contains(l.tools, tool)
}

// limitsFrom —— the verified key's limits, put in ctx by authMiddleware.
func limitsFrom(ctx context.Context) keyLimits {
	v, ok := ctx.Value(ctxKeyScopes).(keyLimits)
	if !ok {
		return keyLimits{scopes: []string{}}
	}
	return v
}

// filter —— tools/list for this key: only the tools in reach.
func (d toolDangers) filter(ctx context.Context, tools []mcpgo.Tool) []mcpgo.Tool {
	lim := limitsFrom(ctx)
	out := make([]mcpgo.Tool, 0, len(tools))
	for i := range tools {
		if classAllowed(lim.scopes, d[tools[i].Name]) && lim.listed(tools[i].Name) {
			out = append(out, tools[i])
		}
	}
	return out
}

// guard —— records the tool's class and refuses a call out of the caller's reach before the
// handler runs.
func (d toolDangers) guard(
	tool, danger string, next server.ToolHandlerFunc,
) server.ToolHandlerFunc {
	d[tool] = danger
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		if msg := d.refusal(ctx, tool); msg != "" {
			return mcpgo.NewToolResultError(msg), nil
		}
		return next(ctx, req)
	}
}

// refusal —— the error a call out of the key's reach gets, or "" when the call may run.
func (d toolDangers) refusal(ctx context.Context, tool string) string {
	lim := limitsFrom(ctx)
	if !lim.listed(tool) {
		return "not allowed: " + tool + " is not on this key's tool list. Create a key that " +
			"names it, or one without a tool list, on /admin (API · MCP)."
	}
	danger := d[tool]
	if classAllowed(lim.scopes, danger) {
		return ""
	}
	if danger == "" {
		danger = "every class"
	}
	return "not allowed: " + tool + " needs the \"" + danger + "\" scope, which this key " +
		"does not have. Create a key with that scope on /admin (API · MCP)."
}
