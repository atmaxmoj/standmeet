// stdio_test.go —— C2: mcpclient stdio 传输的集成测试（spawn 真 MCP server 子进程）。
// 测试替身 = mock-stack/mcp --stdio（含 echo / ping_external + 故障注入）。
// 覆盖 happy（initialize/list/call）+ corner（stderr 不破帧）+ error-stream
// （进程 mid-session 退出 → 干净报错；Close 幂等 + 关后调用报错）。
// 跑在确定环境 → 断言一律 require.*（无 if）。C0 阶段红（DialStdio 是 stub）。
package mcpclient_test

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/mcpclient"
)

const marker = "[EXT-MCP-MARKER]"

// buildMockStdio —— 把 mock-stack 的 mcp server 编译成临时二进制（它是独立
// module，跨 module 用 go build 而非 import）。返回二进制路径。
func buildMockStdio(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "mcpmock")
	cmd := exec.Command("go", "build", "-o", bin, "./mcp")
	cmd.Dir = "../../../mock-stack"
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "build mock stdio server: %s", out)
	return bin
}

// dialMock —— build + DialStdio 一个 --stdio 的 mock server，注册 Close 清理。
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

// happy：initialize 成功 + list 出两个 tool。
func TestStdio_InitializeAndListTools(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	tools, err := sess.ListTools(context.Background())
	require.NoError(t, err)
	names := toolNames(tools)
	require.Contains(t, names, "echo")
	require.Contains(t, names, "ping_external")
}

// happy：call echo → 回 marker:text。
func TestStdio_CallEcho(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	out, err := sess.CallTool(context.Background(), "echo", []byte(`{"text":"hi"}`))
	require.NoError(t, err)
	require.Contains(t, out, marker+":hi")
}

// corner：mock 启动往 stderr 写 banner；若 stderr 串进 stdout 帧，list 会解析失败。
func TestStdio_StderrDoesNotBreakFraming(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	_, err := sess.ListTools(context.Background())
	require.NoError(t, err)
}

// error-stream：进程在第 2 次调用时退出 → 第 1 次 OK，第 2 次干净报错（不 hang/panic）。
func TestStdio_ProcessExitMidSession(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, map[string]string{"MOCK_MCP_EXIT_AFTER": "2"})
	_, err1 := sess.CallTool(context.Background(), "echo", []byte(`{"text":"a"}`))
	require.NoError(t, err1)
	_, err2 := sess.CallTool(context.Background(), "echo", []byte(`{"text":"b"}`))
	require.Error(t, err2)
}

// edge：command 不存在 → DialStdio 返错（不 panic / 不 hang）。
func TestStdio_DialBadCommandErrors(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	_, err := mcpclient.DialStdio(ctx, "/nonexistent/mcp-bin", []string{"--stdio"}, nil)
	require.Error(t, err)
}

// error-stream：进程起来但 initialize 永不响应 → DialStdio 必须超时返错，不永久 hang。
func TestStdio_InitializeTimeoutOnHang(t *testing.T) {
	t.Parallel()
	bin := buildMockStdio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	t.Cleanup(cancel)
	_, err := mcpclient.DialStdio(ctx, bin, []string{"--stdio"},
		map[string]string{"MOCK_MCP_HANG": "1"})
	require.Error(t, err)
}

// error-stream/lifecycle：Close 幂等；关后再调 → 报错（不 panic）。
func TestStdio_CloseIdempotentThenCallErrors(t *testing.T) {
	t.Parallel()
	sess := dialMock(t, nil)
	sess.Close()
	sess.Close()
	_, err := sess.CallTool(context.Background(), "echo", []byte(`{"text":"x"}`))
	require.Error(t, err)
}
