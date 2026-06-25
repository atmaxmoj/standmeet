// capreg_booker_hostedge_test.go —— 错误流矩阵 E3/E4/E5 的单测覆盖。
//
// host-edge 各步失败（E3 句柄构建 / E4 plugin→host socket 不可达 / E5 vault 解密）
// 是 backend 进程内部的失败，没有干净的外部（mock / Playwright）注入点 —— 正是单测
// 该覆盖的：在单元边界喂「脏」错误，断言访客面的唯一出口 marshalBookErr 一律友好
// 降级、绝不泄漏底层错误文本（cipher / dial unix / stack）。业务代码 with/without
// 本测试长得完全一样（无任何测试钩子）。

package usecases

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// hostEdgeLeakTerms —— 任何一项出现在访客面输出里都算泄漏（底层错误文本 / 密文 /
// socket 细节 / stack）。
var hostEdgeLeakTerms = []string{
	"cipher", "nonce", "authentication failed", // E5 解密
	"dial unix", "connection refused", "no such file", "socket", // E4 socket
	"goroutine", "stack", "panic", // 任何 stack 泄漏
}

// friendlyDegrade —— 访客面输出是否是个友好的降级提示（抽出来压 cyclop）。
func friendlyDegrade(out string) bool {
	lower := strings.ToLower(out)
	return strings.Contains(lower, "calendar") || strings.Contains(lower, "unavailable") ||
		strings.Contains(lower, "again") || strings.Contains(lower, "later")
}

// TestMarshalBookErr_HostEdgeFailuresDegradeFriendlyNoLeak —— E3/E4/E5：host-edge
// 各步冒出的「脏」错误经 marshalBookErr → 友好降级，无泄漏。
func TestMarshalBookErr_HostEdgeFailuresDegradeFriendlyNoLeak(t *testing.T) {
	t.Parallel()
	cases := []struct {
		err  error
		name string
	}{
		{errors.New("cryptobox cipher message authentication failed nonce mismatch"), "E5-decrypt"},
		{errors.New("booker op dial unix booker socket connect connection refused"), "E4-socket"},
		{errors.New("build calendar handle goroutine running stack trace"), "E3-handle-build"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out := marshalBookErr(tc.err)
			require.True(t, friendlyDegrade(out), "want friendly degrade hint, got %q", out)
			lower := strings.ToLower(out)
			for _, leak := range hostEdgeLeakTerms {
				require.NotContains(t, lower, leak,
					"visitor-facing output leaked %q: %q", leak, out)
			}
		})
	}
}

// TestMarshalBookErr_KnownErrorsKeepSpecificMessages —— 已知的连接器错误仍映成各自
// 的具体友好文案（回归：default 改成通用降级后，别把已知分支也吞了）。
func TestMarshalBookErr_KnownErrorsKeepSpecificMessages(t *testing.T) {
	t.Parallel()
	require.Contains(t, marshalBookErr(domain.ErrCalendarNotConnected), "not_connected")
	require.Contains(t, marshalBookErr(domain.ErrCalendarRevoked), "reconnect")
	require.Contains(t, marshalBookErr(domain.ErrCalendarUnavailable), "temporarily unavailable")
}
