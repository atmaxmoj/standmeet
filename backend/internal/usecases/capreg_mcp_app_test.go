// capreg_mcp_app_test.go —— C3: mcpAppCapability 适配器测试。
// 用真 stdio mock(mock-stack/mcp --stdio)dial,不 stub Session。覆盖 happy
// (ID/Shape、dial→list→暴露 tool)+ ui→Extra + ACL(role 授权/未授权/无 role)
// + error(dial 失败 / 空 tool → ErrHidden)。tool-call 中途失败折成 errJSON 的
// error-stream 在 C4 e2e(真 chat)断言 + 继承自 ext-mcp。require.*(无 if)。

package usecases

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

const echoerID = "echoer"

func buildPluginMock(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "mcpmock")
	//nolint:gosec // test：把已知 mock server 编译进 t.TempDir()，命令固定。
	cmd := exec.CommandContext(t.Context(), "go", "build", "-o", bin, "./mcp")
	cmd.Dir = "../../../mock-stack"
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "build mock: %s", out)
	return bin
}

func stdioManifest(id, bin string, ui *mcpplugin.UI) *mcpplugin.Manifest {
	return &mcpplugin.Manifest{
		ID:    id,
		Shape: mcpplugin.ShapeVisitorOnly,
		UI:    ui,
		Transport: mcpplugin.Transport{
			Kind: "stdio", Command: bin, Args: []string{"--stdio"},
		},
	}
}

// grantInput —— 一个 code 访客的 AssembleInput，其 role 授权了 pluginID
// (AllowedTools 含它)。没授权就过不了 ACL gate。
func grantInput(pluginID string) *capreg.AssembleInput {
	snap := domain.NewRoleSnapshot(&domain.RoleSnapshotInit{
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
	m := stdioManifest(echoerID, buildPluginMock(t), nil)
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
	m := stdioManifest(echoerID, buildPluginMock(t), nil)
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
	m := stdioManifest(echoerID, buildPluginMock(t), nil)
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

// B2: RegisterDiscoveredPlugins 按传入 origin 注册（bundled 内建 → builtin）。
func TestMCPApp_RegisterWithBuiltinOrigin(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	m := stdioManifest("ask_visitor", buildPluginMock(t), nil)
	skipped := RegisterDiscoveredPlugins(reg, []mcpplugin.Manifest{*m}, capreg.OriginBuiltin)
	require.Empty(t, skipped)
	origin, ok := reg.OriginOf("ask_visitor")
	require.True(t, ok)
	require.Equal(t, capreg.OriginBuiltin, origin)
}

// B1: SystemPromptFragment ← server initialize instructions（prompt 自包含于 server）。
func TestMCPApp_PromptFromInstructions(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t), nil))
	frag := c.SystemPromptFragment(context.Background(), grantInput(echoerID))
	require.Contains(t, frag, "Mock server instructions")
	require.NotEmpty(t, c.SystemPromptFragmentID(context.Background(), grantInput(echoerID)))
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
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t), nil))
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

// happy：manifest 带 ui → CapabilityState.Extra 携带 ui resource_uri + 装配期经
// resources/read 取到的 HTML 模板（#134：前端沙盒渲染取料）。resource_uri 用
// mock 真 serve 的那条，断言内容被读出来嵌进 Extra。
func TestMCPApp_UIMetaIntoExtra(t *testing.T) {
	t.Parallel()
	ui := &mcpplugin.UI{
		ResourceURI: "mock://resource/sample.txt", MimeType: "text/html+mcp",
	}
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t), ui))
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	require.Contains(t, string(b.State.Extra), "mock://resource/sample.txt")
	require.Contains(t, string(b.State.Extra), "[EXT-MCP-MARKER]:resource",
		"ui html template read via resources/read embedded into Extra")
}

// ACL：role 授权了别的、不含本插件 → ErrHidden（即使 mock 在、可 dial）。
func TestMCPApp_NotGrantedHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t), nil))
	_, err := c.VisitorBinding(context.Background(), grantInput("some-other-plugin"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// ACL：无 role（public / byoai，RoleSnapshot=nil）→ ErrHidden。
func TestMCPApp_NoRoleHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t), nil))
	_, err := c.VisitorBinding(context.Background(),
		&capreg.AssembleInput{OwnerID: "o", Mode: "public"})
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// error：role 授权但 dial 不通（命令不存在）→ ErrHidden（隐藏，不阻塞 chat）。
func TestMCPApp_DialFailHidden(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest("broken", "/nonexistent/mcp-bin", nil))
	_, err := c.VisitorBinding(context.Background(), grantInput("broken"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}

// lifecycle：Binding 必须带 Close hook 释放 dial 出的子进程（防资源泄漏）。
func TestMCPApp_BindingHasCloseHook(t *testing.T) {
	t.Parallel()
	c := newMCPAppCapability(stdioManifest(echoerID, buildPluginMock(t), nil))
	b, err := c.VisitorBinding(context.Background(), grantInput(echoerID))
	require.NoError(t, err)
	require.NotNil(t, b.Close)
	b.Close()
}

// edge：role 授权但插件 list 出 0 个 tool → ErrHidden（ext-mcp parity）。
func TestMCPApp_NoToolsHidden(t *testing.T) {
	t.Parallel()
	m := stdioManifest("empty", buildPluginMock(t), nil)
	m.Transport.Env = map[string]string{"MOCK_MCP_NO_TOOLS": "1"}
	c := newMCPAppCapability(m)
	_, err := c.VisitorBinding(context.Background(), grantInput("empty"))
	require.ErrorIs(t, err, capreg.ErrHidden)
}
