// ext_mcp_stats.go —— 进程级 ext MCP 连接计数。invariants spec 在 session
// teardown 后读 stats 验 closed 对齐 dialed，防 connection leak。
//
// ext-mcp capability（B-3 加入）每开关一次连接就调一下。

package agentskills

import "sync/atomic"

var (
	extMCPDialed atomic.Int64
	extMCPClosed atomic.Int64
)

// ExtMCPDialed —— ext-mcp capability dial 成功后调一次（计数 +1）。
func ExtMCPDialed() { extMCPDialed.Add(1) }

// ExtMCPClosed —— ext-mcp capability close 后调一次（计数 +1）。
func ExtMCPClosed() { extMCPClosed.Add(1) }

// ExtMCPStat —— ExtMCPStats 的返回结构（用 struct 而非 (int64, int64)
// 避开 nonamedreturns ↔ confusing-results 互冲）。
type ExtMCPStat struct {
	Dialed int64
	Closed int64
}

// ExtMCPStats —— 读当前进程级计数。
func ExtMCPStats() ExtMCPStat {
	return ExtMCPStat{Dialed: extMCPDialed.Load(), Closed: extMCPClosed.Load()}
}
