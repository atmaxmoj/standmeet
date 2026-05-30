// seo_errors.go —— 共享 SEO 错误翻译 helper。cap_seo.go 用自己的
// agentskills.MCPResult 版；tools_output.go / tools_promote.go (legacy
// AddTool 调用，还没迁) 用 mcp-go 版。两条路径 B-6 / 后续 commit 收口。

package mcp

import (
	"errors"

	mcpgo "github.com/mark3labs/mcp-go/mcp"

	"github.com/wangsijie/standmeet/internal/domain"
)

// seoErrorResult —— legacy 用 mcp-go *CallToolResult shape。等 tools_output /
// tools_promote 都迁成 Capability 后可删。
func seoErrorResult(deps *Deps, err error, name string) *mcpgo.CallToolResult {
	if errors.Is(err, domain.ErrPathTaken) {
		return mcpgo.NewToolResultError("path already taken")
	}
	if errors.Is(err, domain.ErrWikiNotFound) {
		return mcpgo.NewToolResultError("wiki entry not found")
	}
	deps.Log.Error(name, "err", err)
	return mcpgo.NewToolResultError(name + " failed")
}
