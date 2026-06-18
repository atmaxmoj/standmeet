// agentskills_plugin_test.go —— C3: pluginCapability 适配器测试。
// 用真 stdio mock(mock-stack/mcp --stdio)dial,不 stub Session。覆盖 happy
// (ID/Shape、dial→list→暴露 tool)+ ui→Extra + error(dial 失败→ErrHidden)。
// tool-call 中途失败折成 errJSON 的 error-stream 在 C4 e2e(真 chat)断言 +
// 继承自 ext-mcp 既有行为。跑在确定环境 → require.*(无 if)。C0 阶段红。
package usecases

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

func buildPluginMock(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "mcpmock")
	cmd := exec.Command("go", "build", "-o", bin, "./mcp")
	cmd.Dir = "../../../mock-stack"
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "build mock: %s", out)
	return bin
}

func stdioManifest(id, bin string, ui *mcpplugin.UI) mcpplugin.Manifest {
	return mcpplugin.Manifest{
		ID:    id,
		Shape: mcpplugin.ShapeVisitorOnly,
		UI:    ui,
		Transport: mcpplugin.Transport{
			Kind: "stdio", Command: bin, Args: []string{"--stdio"},
		},
	}
}

func bindingToolNames(b *agentskills.Binding) string {
	parts := make([]string, 0, len(b.Tools))
	for i := range b.Tools {
		parts = append(parts, b.Tools[i].Name)
	}
	return strings.Join(parts, ",")
}

// happy：ID / Shape 直接来自 manifest（不 dial）。
func TestPluginCapability_IDAndShape(t *testing.T) {
	t.Parallel()
	c := newPluginCapability(mcpplugin.Manifest{
		ID: "weather", Shape: mcpplugin.ShapeVisitorOnly,
	})
	require.Equal(t, "weather", c.ID())
	require.Equal(t, agentskills.ShapeVisitorOnly, c.Shape())
}

// happy：dial 真 stdio mock → list → 把 echo 暴露成 binding tool。
func TestPluginCapability_DialsAndExposesTools(t *testing.T) {
	t.Parallel()
	c := newPluginCapability(stdioManifest("echoer", buildPluginMock(t), nil))
	b, err := c.VisitorBinding(context.Background(),
		&agentskills.AssembleInput{OwnerID: "o", Mode: "code"})
	require.NoError(t, err)
	require.NotNil(t, b)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	require.Contains(t, bindingToolNames(b), "echo")
}

// happy：manifest 带 ui → CapabilityState.Extra 携带 ui resourceUri（#134 接点）。
func TestPluginCapability_UIMetaIntoExtra(t *testing.T) {
	t.Parallel()
	ui := &mcpplugin.UI{ResourceURI: "ui://card", MimeType: "text/html+mcp"}
	c := newPluginCapability(stdioManifest("echoer", buildPluginMock(t), ui))
	b, err := c.VisitorBinding(context.Background(),
		&agentskills.AssembleInput{OwnerID: "o", Mode: "code"})
	require.NoError(t, err)
	t.Cleanup(func() {
		if b.Close != nil {
			b.Close()
		}
	})
	require.Contains(t, string(b.State.Extra), "ui://card")
}

// error：dial 不通（命令不存在）→ ErrHidden（capability 隐藏，不阻塞 chat）。
func TestPluginCapability_DialFailHidden(t *testing.T) {
	t.Parallel()
	c := newPluginCapability(stdioManifest("broken", "/nonexistent/mcp-bin", nil))
	_, err := c.VisitorBinding(context.Background(),
		&agentskills.AssembleInput{OwnerID: "o", Mode: "code"})
	require.ErrorIs(t, err, agentskills.ErrHidden)
}

// lifecycle：Binding 必须带 Close hook 释放 dial 出的子进程（防资源泄漏）。
func TestPluginCapability_BindingHasCloseHook(t *testing.T) {
	t.Parallel()
	c := newPluginCapability(stdioManifest("echoer", buildPluginMock(t), nil))
	b, err := c.VisitorBinding(context.Background(),
		&agentskills.AssembleInput{OwnerID: "o", Mode: "code"})
	require.NoError(t, err)
	require.NotNil(t, b.Close)
	b.Close()
}

// edge：插件 list 出 0 个 tool → ErrHidden（ext-mcp parity：没东西暴露就隐藏）。
func TestPluginCapability_NoToolsHidden(t *testing.T) {
	t.Parallel()
	m := stdioManifest("empty", buildPluginMock(t), nil)
	m.Transport.Env = map[string]string{"MOCK_MCP_NO_TOOLS": "1"}
	c := newPluginCapability(m)
	_, err := c.VisitorBinding(context.Background(),
		&agentskills.AssembleInput{OwnerID: "o", Mode: "code"})
	require.ErrorIs(t, err, agentskills.ErrHidden)
}
