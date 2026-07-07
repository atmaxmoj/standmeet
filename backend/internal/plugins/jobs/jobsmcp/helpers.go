// helpers.go —— J.3: jobs plugin 的 MCP 小工具。JSON 响应封装现在用共享的 capreg.MarshalResult
// (不再复制那 8 行)；这里只留 jobs 专用的时间格式常量。

package jobsmcp

// mcpTimeFmt —— ISO-8601 UTC 时间格式 (Go 标准)。
const mcpTimeFmt = "2006-01-02T15:04:05Z"
