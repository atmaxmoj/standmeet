// helpers.go —— J.3: jobs plugin 的 MCP 小工具。从 internal/mcp/cap_helpers.go
// 复用 marshalCapResult + mcpTimeFmt；不能 import internal/mcp (会引入
// internal/mcp -> jobsmcp -> internal/mcp 循环依赖)，复制一份 8 行。
//
// 后续若 helpers 真涨大可抽 internal/mcputil 共享包；当下 2 个 symbol 不
// 值得另起 package。

package jobsmcp

import (
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
)

// mcpTimeFmt —— ISO-8601 UTC 时间格式 (Go 标准；跟 internal/mcp 同源)。
const mcpTimeFmt = "2006-01-02T15:04:05Z"

// marshalCapResult —— 通用 capability handler JSON 响应封装；跟
// internal/mcp/cap_helpers.go 同源。
func marshalCapResult(log *slog.Logger, name string, payload any) capreg.MCPResult {
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("cap marshal", "tool", name, "err", err)
		return capreg.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return capreg.MCPSuccess(string(out))
}
