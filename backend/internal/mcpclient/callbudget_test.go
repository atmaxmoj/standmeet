// callbudget_test.go —— F-A-6: a tool that takes longer than the default 15s CallTool cap (a
// full LLM report generation, e.g. summarize) must be callable under a larger per-tool budget.
// The generic cap would time such a call out mid-flight, leaving the inline card blank while the
// host op still finishes and persists the report. CallToolWithin honours the caller's budget.

package mcpclient_test

import (
	"context"
	"testing"
	"time"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	mcpgoserver "github.com/mark3labs/mcp-go/server"
	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/mcpclient"
)

// buildSlowServer —— an in-process server whose "slow" tool sleeps `delay` before replying, to
// stand in for a long host-side generation without a real 15s wait.
func buildSlowServer(delay time.Duration) *mcpgoserver.MCPServer {
	srv := mcpgoserver.NewMCPServer("slow-fixture", "1.0.0",
		mcpgoserver.WithToolCapabilities(true))
	srv.AddTool(mcpgo.NewTool("slow", mcpgo.WithDescription("slow fixture")), func(
		ctx context.Context, _ mcpgo.CallToolRequest,
	) (*mcpgo.CallToolResult, error) {
		select {
		case <-time.After(delay):
			return mcpgo.NewToolResultText("REPORT-BODY"), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	return srv
}

func TestCallToolWithin_HonorsBudget(t *testing.T) {
	t.Parallel()
	slow := buildSlowServer(300 * time.Millisecond)
	sess, err := mcpclient.DialInProcess(context.Background(), slow)
	require.NoError(t, err)
	t.Cleanup(sess.Close)

	// budget SHORTER than the tool's work → the call is cut off (the F-A-6 blank-card path).
	_, tooShort := sess.CallToolWithin(
		context.Background(), "slow", []byte(`{}`), nil, 50*time.Millisecond,
	)
	require.Error(t, tooShort, "a budget below the tool's runtime must time the call out")

	// budget LONGER than the tool's work → the real result comes back intact.
	out, ok := sess.CallToolWithin(
		context.Background(), "slow", []byte(`{}`), nil, 5*time.Second,
	)
	require.NoError(t, ok)
	require.Equal(t, "REPORT-BODY", out)
}

func TestLongCallTimeout_ExceedsDefault(t *testing.T) {
	t.Parallel()
	// The whole point: the long budget must be well above the default cap that cut summarize off.
	require.Greater(t, mcpclient.LongCallTimeout, 15*time.Second)
}
