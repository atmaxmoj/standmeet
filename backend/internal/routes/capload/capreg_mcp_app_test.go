// capreg_mcp_app_test.go —— C3: tests for the mcpAppCapability adapter.
// Dials with a real stdio mock (mock-stack/mcp --stdio), never stubbing Session. Covers
// happy paths (ID/Shape, dial→list→expose tool) + ui→Extra + ACL (role granted / not
// granted / no role) + error cases (dial failure / empty tools → ErrHidden). The
// error-stream where a mid-call tool failure folds into errJSON is asserted by the C4 e2e
// (real chat) suite and inherited from ext-mcp. require.* only (no if).

package capload

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	mcpgoserver "github.com/mark3labs/mcp-go/server"
	"github.com/stretchr/testify/require"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

const echoerID = "echoer"

func buildPluginMock(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "mcpmock")
	//nolint:gosec // test: compiles a known mock server into t.TempDir(), a fixed command.
	cmd := exec.CommandContext(t.Context(), "go", "build", "-o", bin, "./mcp")
	cmd.Dir = "../../../../mock-stack"
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "build mock: %s", out)
	return bin
}

func stdioManifest(id, bin string) *mcpplugin.Manifest {
	return &mcpplugin.Manifest{
		ID:    id,
		Shape: mcpplugin.ShapeVisitorOnly,
		Transport: mcpplugin.Transport{
			Kind: "stdio", Command: bin, Args: []string{"--stdio"},
		},
	}
}

// grantInput —— a code visitor's AssembleInput whose role grants pluginID (AllowedTools
// contains it). Without the grant, it can't pass the ACL gate.
func grantInput(pluginID string) *capreg.AssembleInput {
	snap := access.NewRoleSnapshot(&access.RoleSnapshotInit{
		AllowedTools: []string{pluginID},
	})
	return &capreg.AssembleInput{OwnerID: "o", Mode: "code", RoleSnapshot: &snap}
}

func bindingToolNames(b *capreg.Binding) string {
	parts := make([]string, 0, len(b.Tools))
	for i := range b.Tools {
		parts = append(parts, b.Tools[i].Name)
	}
	return strings.Join(parts, ",")
}

// noRoleInput —— a public visitor (no role). An ACL=always capability should still be
// exposed even so.
func noRoleInput() *capreg.AssembleInput {
	return &capreg.AssembleInput{OwnerID: "o", Mode: "public"}
}

func findTool(b *capreg.Binding, name string) (capreg.BindingTool, bool) {
	for i := range b.Tools {
		if b.Tools[i].Name == name {
			return b.Tools[i], true
		}
	}
	return capreg.BindingTool{}, false
}

// B1: ACL=always → exposed even without a role (an externalized builtin base capability,
// for every mode).
func TestMCPApp_ACLAlwaysExposesWithoutRole(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.ACL = mcpplugin.ACLAlways
	c := newMCPAppCapability(m)
	b, err := c.VisitorBinding(context.Background(), noRoleInput())
	require.NoError(t, err)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	require.Contains(t, bindingToolNames(b), "echo")
}

// B1: RawToolNames=true → tools use the server's original name, no <id>_ prefix added.
func TestMCPApp_RawToolNames(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.RawToolNames = true
	c := newMCPAppCapability(m)
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	_, ok := findTool(b, "echo")
	require.True(t, ok, "raw name 'echo' present, not 'echoer_echo'")
	_, prefixed := findTool(b, "echoer_echo")
	require.False(t, prefixed, "no <id>_ prefix when RawToolNames")
}

// B1: tool `_meta.return_directly` → BindingTool.ReturnDirectly=true (clarify has it).
func TestMCPApp_ReturnDirectlyFromMeta(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.RawToolNames = true
	c := newMCPAppCapability(m)
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	clarify, ok := findTool(b, "clarify")
	require.True(t, ok)
	require.True(t, clarify.ReturnDirectly, "clarify declares _meta.return_directly")
	echo, ok := findTool(b, "echo")
	require.True(t, ok)
	require.False(t, echo.ReturnDirectly, "echo has no return_directly meta")
}

// in_process goes through **the exact same** RegisterDiscoveredPlugins + mcpAppCapability +
// dialMCPApp (unified): manifest.Transport.Kind=in_process plus a same-process server
// object, VisitorBinding connects in-memory directly and exposes tools. No process/thread/
// network gets opened.
func TestMCPApp_InProcessUnifiedPath(t *testing.T) {
	t.Parallel()
	srv := mcpgoserver.NewMCPServer("inproc-cap", "1.0.0",
		mcpgoserver.WithToolCapabilities(true))
	srv.AddTool(mcpgo.NewTool("do_thing", mcpgo.WithDescription("fixture")), func(
		_ context.Context, _ mcpgo.CallToolRequest,
	) (*mcpgo.CallToolResult, error) {
		return mcpgo.NewToolResultText("ok"), nil
	})
	m := &mcpplugin.Manifest{
		ID: "inproc_cap", Shape: mcpplugin.ShapeVisitorOnly, ACL: mcpplugin.ACLAlways,
		RawToolNames: true,
		Transport: mcpplugin.Transport{
			Kind: mcpplugin.TransportInProcess, InProcessServer: srv,
		},
	}
	reg := capreg.NewRegistry()
	skipped := RegisterDiscoveredPlugins(reg, []mcpplugin.Manifest{*m}, capreg.OriginBuiltin, nil)
	require.Empty(t, skipped)

	c := newMCPAppCapability(m)
	b, err := c.VisitorBinding(context.Background(), noRoleInput())
	require.NoError(t, err)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	require.Contains(t, bindingToolNames(b), "do_thing")
}

// B2: RegisterDiscoveredPlugins registers with whatever origin is passed in (a bundled
// builtin → builtin).
func TestMCPApp_RegisterWithBuiltinOrigin(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	m := stdioManifest("ask_visitor", buildPluginMock(t))
	skipped := RegisterDiscoveredPlugins(reg, []mcpplugin.Manifest{*m}, capreg.OriginBuiltin, nil)
	require.Empty(t, skipped)
	origin, ok := reg.OriginOf("ask_visitor")
	require.True(t, ok)
	require.Equal(t, capreg.OriginBuiltin, origin)
}

// B1: SystemPromptFragment ← server initialize instructions (the prompt is self-contained
// within the server).
func TestMCPApp_PromptFromInstructions(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	frag := c.SystemPromptFragment(context.Background(), grantInput(echoerID))
	require.Contains(t, frag, "Mock server instructions")
	// FragmentID = "capabilities/<id>": after externalization, the server's initialize
	// instructions are served via the registry's PromptFragmentText fallback, fed to the
	// frontend under this part-id (/prompts/capabilities/<id>), through the unified
	// part-id loading channel.
	require.Equal(t, "capabilities/echoer",
		c.SystemPromptFragmentID(context.Background(), grantInput(echoerID)))
}

// happy: ID / Shape come straight from the manifest (no dial).
func TestMCPApp_IDAndShape(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(&mcpplugin.Manifest{
		ID: "weather", Shape: mcpplugin.ShapeVisitorOnly,
	})
	require.Equal(t, "weather", c.ID())
	require.Equal(t, capreg.ShapeVisitorOnly, c.Shape())
}

// happy: role granted → dial the real stdio mock → list → expose echo as a binding tool.
func TestMCPApp_DialsAndExposesTools(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	require.NotNil(t, b)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	require.Contains(t, bindingToolNames(b), "echo")
}

// happy: a tool declares a ui:// card via `_meta.ui_resource` (MCP Apps, per-tool) →
// resources/read at assembly time gets the HTML attached to that tool's
// BindingTool.UIHTML. The mock's clarify tool declares it, and the assertion checks the
// read content is embedded into UIHTML.
func TestMCPApp_PerToolUIHTML(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.RawToolNames = true // canonical names (clarify/echo), no <id>_ prefix added
	c := newMCPAppCapability(m)
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	require.Contains(t, toolUIHTMLByName(b, "clarify"), "[EXT-MCP-MARKER]:resource",
		"ui html read via resources/read attached to the declaring tool")
	require.Empty(t, toolUIHTMLByName(b, "echo"), "tool without ui_resource carries no card")
}

// toolUIHTMLByName —— fetches a tool's UIHTML from a binding by name (a test helper).
func toolUIHTMLByName(b *capreg.Binding, name string) string {
	for i := range b.Tools {
		if b.Tools[i].Name == name {
			return b.Tools[i].UIHTML
		}
	}
	return ""
}

// ACL: role granted something else, not this plugin → ErrHidden (even though the mock is
// present and dialable).
func TestMCPApp_NotGrantedHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	_, err := c.VisitorBinding(context.Background(), grantInput("some-other-plugin"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// ACL: no role (public / byoai, RoleSnapshot=nil) → ErrHidden.
func TestMCPApp_NoRoleHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	_, err := c.VisitorBinding(context.Background(),
		&capreg.AssembleInput{OwnerID: "o", Mode: "public"})
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// error: role granted but dial fails (command doesn't exist) → ErrHidden (hidden, without
// blocking chat).
func TestMCPApp_DialFailHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest("broken", "/nonexistent/mcp-bin"))
	_, err := c.VisitorBinding(context.Background(), grantInput("broken"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// lifecycle: a Binding must carry a Close hook that releases the dialed subprocess (to
// prevent a resource leak).
func TestMCPApp_BindingHasCloseHook(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	require.NotNil(t, b.Close)
	b.Close()
}

// edge: role granted but the plugin lists 0 tools → ErrHidden (ext-mcp parity).
func TestMCPApp_NoToolsHidden(t *testing.T) {
	t.Parallel()
	m := stdioManifest("empty", buildPluginMock(t))
	m.Transport.Env = map[string]string{"MOCK_MCP_NO_TOOLS": "1"}
	c := newMCPAppCapability(m)
	_, err := c.VisitorBinding(context.Background(), grantInput("empty"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// F-A-1 observability guard: before a dial failure (the sandbox won't start) folds into
// ErrHidden, the real cause must be fed to dialErrLog (otherwise it's silent 0-tools with
// nothing in the logs, just like the prod bwrap case); whereas a clean "0 tools" is
// legitimately hidden and must not report an error.
func TestMCPApp_DialFail_FiresDialErrLog(t *testing.T) {
	t.Parallel()
	var gotID string
	var gotErr error
	c := newMCPAppCapability(stdioManifest("broken", "/nonexistent/mcp-bin"))
	c.dialErrLog = func(id string, err error) { gotID = id; gotErr = err }
	_, err := c.VisitorBinding(context.Background(), grantInput("broken"))
	require.ErrorIs(t, err, capreg.ErrHidden)
	require.Equal(t, "broken", gotID, "dial failure must report the cap id")
	require.Error(t, gotErr, "dial failure must report the underlying error")

	// A clean "0 tools" is legitimately hidden, and must not fire dialErrLog.
	m := stdioManifest("empty", buildPluginMock(t))
	m.Transport.Env = map[string]string{"MOCK_MCP_NO_TOOLS": "1"}
	c2 := newMCPAppCapability(m)
	fired := false
	c2.dialErrLog = func(string, error) { fired = true }
	_, err2 := c2.VisitorBinding(context.Background(), grantInput("empty"))
	require.ErrorIs(t, err2, capreg.ErrHidden)
	require.False(t, fired, "a clean no-tools hide must NOT fire dialErrLog")
}
