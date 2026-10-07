// scopes.go —— a key reaches only the tools its scopes cover (refactor ledger R7).
//
// Every tool on this face has a danger class: a dispatcher op's is DangerOf() (R8), a registry
// binding's is the class it declares. A key's scopes are the classes it may use. tools/list shows
// only the tools in scope, and a call outside scope is refused with the class it needed — the
// listing keeps an honest client from trying, the refusal stops one that tries anyway.

package mcphandle

import (
	"context"
	"slices"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

var ctxKeyScopes = ctxKey{name: "mcpScopes"}

// toolDangers —— tool name → its danger class, filled as the tools are registered. A tool that
// declares no class is reachable by a key with every class only.
type toolDangers map[string]string

// allowed —— whether a key with these scopes may use a tool of this class.
func allowed(scopes []string, danger string) bool {
	if danger == "" {
		return len(scopes) == len(fp.AllDangers())
	}
	return slices.Contains(scopes, danger)
}

// scopesFrom —— the verified key's scopes, put in ctx by authMiddleware.
func scopesFrom(ctx context.Context) []string {
	v, ok := ctx.Value(ctxKeyScopes).([]string)
	if !ok {
		return []string{}
	}
	return v
}

// filter —— tools/list for this key: only the tools in its scopes.
func (d toolDangers) filter(ctx context.Context, tools []mcpgo.Tool) []mcpgo.Tool {
	scopes := scopesFrom(ctx)
	out := make([]mcpgo.Tool, 0, len(tools))
	for i := range tools {
		if allowed(scopes, d[tools[i].Name]) {
			out = append(out, tools[i])
		}
	}
	return out
}

// guard —— records the tool's class and refuses a call outside the caller's scopes before the
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

// refusal —— the error a call outside the key's scopes gets, or "" when the call may run.
func (d toolDangers) refusal(ctx context.Context, tool string) string {
	danger := d[tool]
	if allowed(scopesFrom(ctx), danger) {
		return ""
	}
	if danger == "" {
		danger = "every class"
	}
	return "not allowed: " + tool + " needs the \"" + danger + "\" scope, which this key " +
		"does not have. Create a key with that scope on /admin (API · MCP)."
}
