// scopes.go —— a key reaches only the tools its scopes cover (refactor ledger R7), and, when it
// names some, only those tools (job-loop roadmap 8.5.a).
//
// Every tool on this face has a danger class: a dispatcher op's is DangerOf() (R8), a registry
// binding's is the class it declares. A key's scopes are the classes it may use; its tool list,
// when not empty, narrows further to named tools. tools/list shows only the tools in reach, and a
// call out of reach is refused with what it needed — the listing keeps an honest client from
// trying, the refusal stops one that tries anyway. The rule itself is fp.KeyReach.

package mcphandle

import (
	"context"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

var ctxKeyScopes = ctxKey{name: "mcpScopes"}

// toolDangers —— tool name → its danger class, filled as the tools are registered. A tool that
// declares no class is reachable by a key with every class only.
type toolDangers map[string]string

// reachFrom —— the verified key's reach, put in ctx by authMiddleware; none without a key.
func reachFrom(ctx context.Context) fp.KeyReach {
	v, ok := ctx.Value(ctxKeyScopes).(fp.KeyReach)
	if !ok {
		return fp.KeyReach{Scopes: []string{}}
	}
	return v
}

// filter —— tools/list for this key: only the tools in reach.
func (d toolDangers) filter(ctx context.Context, tools []mcpgo.Tool) []mcpgo.Tool {
	reach := reachFrom(ctx)
	out := make([]mcpgo.Tool, 0, len(tools))
	for i := range tools {
		if reach.Allows(tools[i].Name, d[tools[i].Name]) {
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
		if msg := reachFrom(ctx).Refusal(tool, d[tool]); msg != "" {
			return mcpgo.NewToolResultError(msg), nil
		}
		return next(ctx, req)
	}
}
