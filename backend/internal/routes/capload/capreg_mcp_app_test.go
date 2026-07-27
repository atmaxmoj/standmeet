// capreg_mcp_app_test.go —— C3: mcpAppCapability 适配器测试。
// 用真 stdio mock(mock-stack/mcp --stdio)dial,不 stub Session。覆盖 happy
// (ID/Shape、dial→list→暴露 tool)+ ui→Extra + ACL(role 授权/未授权/无 role)
// + error(dial 失败 / 空 tool → ErrHidden)。tool-call 中途失败折成 errJSON 的
// error-stream 在 C4 e2e(真 chat)断言 + 继承自 ext-mcp。require.*(无 if)。

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
	//nolint:gosec // test：把已知 mock server 编译进 t.TempDir()，命令固定。
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

// grantInput —— 一个 code 访客的 AssembleInput，其 role 授权了 pluginID
// (AllowedTools 含它)。没授权就过不了 ACL gate。
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

// noRoleInput —— public 访客（无 role）。ACL=always 的能力即便如此也该暴露。
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

// B1: ACL=always → 无 role 也暴露（外置内建基础能力，所有 mode）。
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

// B1: RawToolNames=true → 工具用 server 原名，不加 <id>_ 前缀。
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

// B1: tool `_meta.return_directly` → BindingTool.ReturnDirectly=true（clarify 带）。
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

// in-process 走**同一条** RegisterDiscoveredPlugins + mcpAppCapability + dialMCPApp
// （归一）：manifest.Transport.Kind=in_process + 一个同进程 server 对象，VisitorBinding
// 内存直连、暴露 tool。不开进程/线程/网络。
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

// B2: RegisterDiscoveredPlugins 按传入 origin 注册（bundled 内建 → builtin）。
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

// B1: SystemPromptFragment ← server initialize instructions（prompt 自包含于 server）。
func TestMCPApp_PromptFromInstructions(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	frag := c.SystemPromptFragment(context.Background(), grantInput(echoerID))
	require.Contains(t, frag, "Mock server instructions")
	// FragmentID = "capabilities/<id>"：externalize 后 server 的 initialize
	// instructions 经 registry PromptFragmentText 兜底，按这个 part-id 喂给前端
	// （/prompts/capabilities/<id>），统一走 part-id 加载通道。
	require.Equal(t, "capabilities/echoer",
		c.SystemPromptFragmentID(context.Background(), grantInput(echoerID)))
}

// happy：ID / Shape 直接来自 manifest（不 dial）。
func TestMCPApp_IDAndShape(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(&mcpplugin.Manifest{
		ID: "weather", Shape: mcpplugin.ShapeVisitorOnly,
	})
	require.Equal(t, "weather", c.ID())
	require.Equal(t, capreg.ShapeVisitorOnly, c.Shape())
}

// happy：role 授权 → dial 真 stdio mock → list → 把 echo 暴露成 binding tool。
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

// happy：tool 经 `_meta.ui_resource` 声明 ui:// 卡（MCP Apps，per-tool）→ 装配期
// resources/read 取到 HTML 挂到该 tool 的 BindingTool.UIHTML。mock 的 clarify tool
// 声明了它，断言读到的内容嵌进 UIHTML。
func TestMCPApp_PerToolUIHTML(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.RawToolNames = true // canonical 名（clarify/echo），不加 <id>_ 前缀
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

// toolUIHTMLByName —— binding 里按名取某 tool 的 UIHTML（测试 helper）。
func toolUIHTMLByName(b *capreg.Binding, name string) string {
	for i := range b.Tools {
		if b.Tools[i].Name == name {
			return b.Tools[i].UIHTML
		}
	}
	return ""
}

// ACL：role 授权了别的、不含本插件 → ErrHidden（即使 mock 在、可 dial）。
func TestMCPApp_NotGrantedHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	_, err := c.VisitorBinding(context.Background(), grantInput("some-other-plugin"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// ACL：无 role（public / byoai，RoleSnapshot=nil）→ ErrHidden。
func TestMCPApp_NoRoleHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	_, err := c.VisitorBinding(context.Background(),
		&capreg.AssembleInput{OwnerID: "o", Mode: "public"})
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// error：role 授权但 dial 不通（命令不存在）→ ErrHidden（隐藏，不阻塞 chat）。
func TestMCPApp_DialFailHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest("broken", "/nonexistent/mcp-bin"))
	_, err := c.VisitorBinding(context.Background(), grantInput("broken"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// lifecycle：Binding 必须带 Close hook 释放 dial 出的子进程（防资源泄漏）。
func TestMCPApp_BindingHasCloseHook(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t)))
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	require.NotNil(t, b.Close)
	b.Close()
}

// edge：role 授权但插件 list 出 0 个 tool → ErrHidden（ext-mcp parity）。
func TestMCPApp_NoToolsHidden(t *testing.T) {
	t.Parallel()
	m := stdioManifest("empty", buildPluginMock(t))
	m.Transport.Env = map[string]string{"MOCK_MCP_NO_TOOLS": "1"}
	c := newMCPAppCapability(m)
	_, err := c.VisitorBinding(context.Background(), grantInput("empty"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// F-A-1 观测性守卫：dial 不通(sandbox 起不来)在折成 ErrHidden 前必须把真因喂给
// dialErrLog(否则像 prod bwrap 那样静默 0 工具、日志查无此事);而干净的「0 tool」是
// 合法隐藏,不该报错。
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

	// 干净的「0 tool」是合法隐藏，不触发 dialErrLog。
	m := stdioManifest("empty", buildPluginMock(t))
	m.Transport.Env = map[string]string{"MOCK_MCP_NO_TOOLS": "1"}
	c2 := newMCPAppCapability(m)
	fired := false
	c2.dialErrLog = func(string, error) { fired = true }
	_, err2 := c2.VisitorBinding(context.Background(), grantInput("empty"))
	require.ErrorIs(t, err2, capreg.ErrHidden)
	require.False(t, fired, "a clean no-tools hide must NOT fire dialErrLog")
}
