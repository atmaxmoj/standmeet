// ext_mcp_stats.go — process-level ext MCP connection counters. The
// invariants spec reads the stats after session teardown to verify closed
// matches dialed, guarding against a connection leak.
//
// The ext-mcp capability (added in B-3) calls this once per connection
// open/close.

package capreg

import "sync/atomic"

var (
	extMCPDialed atomic.Int64
	extMCPClosed atomic.Int64
)

// ExtMCPDialed — call once after an ext-mcp capability dial succeeds
// (counter +1).
func ExtMCPDialed() { extMCPDialed.Add(1) }

// ExtMCPClosed — call once after an ext-mcp capability closes (counter +1).
func ExtMCPClosed() { extMCPClosed.Add(1) }

// ExtMCPStat — the return shape of ExtMCPStats (a struct instead of
// (int64, int64) to avoid the nonamedreturns ↔ confusing-results lint
// conflict).
type ExtMCPStat struct {
	Dialed int64
	Closed int64
}

// ExtMCPStats — reads the current process-level counters.
func ExtMCPStats() ExtMCPStat {
	return ExtMCPStat{Dialed: extMCPDialed.Load(), Closed: extMCPClosed.Load()}
}
