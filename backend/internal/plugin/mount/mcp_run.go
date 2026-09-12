// mcp_run.go —— calling one dialed MCP tool, and what a failure looks like to the agent loop.
//
// Shared by the two things that dial an MCP server and expose its tools: the mounted block
// (state.go, in this package) and the ext-mcp loader (routes/blockload). It lives here rather
// than beside either one because it is about the MCP transport, not about who dialed it — and
// the ext-mcp loader had to move out to routes/ to avoid a domain cycle, which would have left
// one of the two callers reaching across for a helper that belongs to neither.

package mount

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// MakeMCPRun —— don't let a CallTool failure abort the whole agent loop — wrap the
// err as errJSON inside tool_result, so the AI sees "external tool failed" and routes
// around it itself. budget is this tool's call budget (<=0 uses the default 15s;
// LLM-backed summarize passes LongCallTimeout, see F-A-6).
func MakeMCPRun(
	session *mcpclient.Session, realToolName string, sctx *mcpclient.SessionContext,
	budget time.Duration,
) registry.RunFn {
	return func(ctx context.Context, args string) (string, error) {
		return CallToToolResult(
			session.CallToolWithin(ctx, realToolName, []byte(args), sctx, budget),
		)
	}
}

// CallToToolResult —— fold a CallTool err into an errJSON tool_result, so the SDK
// continues rather than aborting (returning nil for the Go-side err is the RunFn
// contract).
//
// The nil is deliberate — it lets the agent loop continue instead of aborting the
// whole stream.
//
//nolint:nilerr // tool-result envelope: err goes into the JSON text, Go err return
func CallToToolResult(out string, err error) (string, error) {
	if err != nil {
		return errJSON("external mcp tool: " + err.Error()), nil
	}
	return out, nil
}
