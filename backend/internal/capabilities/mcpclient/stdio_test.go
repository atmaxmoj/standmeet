// stdio_test.go —— C2: integration tests for mcpclient's stdio transport (spawns a
// real MCP server subprocess). Test double = mock-stack/mcp --stdio (has echo /
// ping_external + fault injection). Covers happy (initialize/list/call) + corner
// (stderr doesn't break framing) + error-stream (process exits mid-session /
// initialize hangs → clean error; Close is idempotent + calling after close errors).
// Runs in a deterministic environment → assertions are all require.* (no if).

package mcpclient_test

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
)

const marker = "[EXT-MCP-MARKER]"

// buildMockStdio —— compiles mock-stack's mcp server into a temp binary (it's a
// separate module, so cross-module uses go build rather than import). Returns the
// binary's path.
func buildMockStdio(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "mcpmock")
	//nolint:gosec // test: compiles a known mock server into t.TempDir(), command is fixed.
	cmd := exec.CommandContext(t.Context(), "go", "build", "-o", bin, "./mcp")
	cmd.Dir = "../../../../mock-stack"
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "build mock stdio server: %s", out)
	return bin
}

// dialMock —— build + DialStdio a --stdio mock server, registering Close for cleanup.
func dialMock(t *testing.T, env map[string]string) *mcpclient.Session {
	t.Helper()
	bin := buildMockStdio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	sess, err := mcpclient.DialStdio(ctx, bin, []string{"--stdio"}, env)
	require.NoError(t, err)
	t.Cleanup(sess.Close)
	return sess
}

func toolNames(tools []mcpclient.Tool) []string {
	out := make([]string, 0, len(tools))
	for i := range tools {
		out = append(out, tools[i].Name)
	}
	return out
}

// happy: initialize succeeds + list returns two tools.
func TestStdio_InitializeAndListTools(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	tools, err := sess.ListTools(context.Background())
	require.NoError(t, err)
	names := toolNames(tools)
	require.Contains(t, names, "echo")
	require.Contains(t, names, "ping_external")
}

// Session.Instructions() —— the server's initialize instructions surface unchanged
// (the vehicle an externalized capability uses to carry a system-prompt fragment).
func TestStdio_SurfacesServerInstructions(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	require.Equal(t,
		"Mock server instructions: use echo to test framing.",
		sess.Instructions())
}

// Tool.Meta —— a tool's custom `_meta` fields pass through (the vehicle an
// externalized capability uses to declare ReturnDirectly). clarify carries
// return_directly=true; echo doesn't → Meta is nil.
func TestStdio_SurfacesToolMeta(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	tools, err := sess.ListTools(context.Background())
	require.NoError(t, err)
	byName := map[string]mcpclient.Tool{}
	for _, tl := range tools {
		byName[tl.Name] = tl
	}
	require.Equal(t, true, byName["clarify"].Meta["return_directly"],
		"clarify tool surfaces _meta.return_directly")
	require.Empty(t, byName["echo"].Meta, "echo tool has no _meta")
}

// ReadResource —— resources/read transport works: fetches back the resource's text
// content. The real ui:// card comes from the externalized capability server itself;
// this only verifies the transport layer.
func TestStdio_ReadResource(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	text, err := sess.ReadResource(context.Background(), "mock://resource/sample.txt")
	require.NoError(t, err)
	require.Contains(t, text, marker+":resource")
}

// happy: call echo → returns marker:text.
func TestStdio_CallEcho(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	out, err := sess.CallTool(context.Background(), "echo", []byte(`{"text":"hi"}`), nil)
	require.NoError(t, err)
	require.Contains(t, out, marker+":hi")
}

// corner: mock writes a banner to stderr on startup; if stderr bleeds into the stdout
// frames, list will fail to parse.
func TestStdio_StderrDoesNotBreakFraming(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	_, err := sess.ListTools(context.Background())
	require.NoError(t, err)
}

// error-stream: the process exits on the 2nd call → 1st call OK, 2nd call errors
// cleanly (no hang/panic).
func TestStdio_ProcessExitMidSession(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, map[string]string{"MOCK_MCP_EXIT_AFTER": "2"})
	_, err1 := sess.CallTool(context.Background(), "echo", []byte(`{"text":"a"}`), nil)
	require.NoError(t, err1)
	_, err2 := sess.CallTool(context.Background(), "echo", []byte(`{"text":"b"}`), nil)
	require.Error(t, err2)
}

// edge: command doesn't exist → DialStdio returns an error (no panic / no hang).
func TestStdio_DialBadCommandErrors(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	_, err := mcpclient.DialStdio(ctx, "/nonexistent/mcp-bin", []string{"--stdio"}, nil)
	require.Error(t, err)
}

// error-stream: the process comes up but initialize never responds → DialStdio must
// time out and return an error, never hanging forever.
func TestStdio_InitializeTimeoutOnHang(t *testing.T) {
	t.Parallel()
	bin := buildMockStdio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	t.Cleanup(cancel)
	_, err := mcpclient.DialStdio(ctx, bin, []string{"--stdio"},
		map[string]string{"MOCK_MCP_HANG": "1"})
	require.Error(t, err)
}

// error-stream/lifecycle: Close is idempotent; calling again after close → errors (no panic).
func TestStdio_CloseIdempotentThenCallErrors(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	sess.Close()
	sess.Close()
	_, err := sess.CallTool(context.Background(), "echo", []byte(`{"text":"x"}`), nil)
	require.Error(t, err)
}
