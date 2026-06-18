// stdio.go —— C2: MCP stdio 传输（core 把插件当子进程拉起来，走 stdin/stdout）。
// 现为 stub（红）—— C0 先写测试，C2 实现：spawn 子进程 + Initialize + 进程回收。
package mcpclient

import (
	"context"
	"errors"
)

// errStdioNotImplemented —— C2 未实现的占位错误（让 C0 测试红得干净）。
var errStdioNotImplemented = errors.New("mcpclient: DialStdio not implemented (C2)")

// DialStdio —— spawn command（带 args/env）作 MCP server 子进程，走 stdio 传输，
// Initialize 后返 Session。env 是 K=V 注入子进程环境（per-owner 凭据走这里，
// 但 C2 只做传输；注入策略在 connector 层）。
func DialStdio(
	_ context.Context, _ string, _ []string, _ map[string]string,
) (*Session, error) {
	return nil, errStdioNotImplemented
}
