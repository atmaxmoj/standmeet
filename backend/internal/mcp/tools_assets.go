// tools_assets.go —— assets MCP tools。MVP 只 expose orphan 扫 / GC：
//
//   - assets_orphans  —— GET equivalent，dry-run 列没人引的 asset
//   - assets_gc       —— DELETE equivalent，真删 storage + repo 行
//
// upload 走 multipart admin route，不进 MCP（AI 不会 raw 字节传图；
// 后续如果要让 AI 引图，加 `upload_asset_from_url` tool 接 URL）。

package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/usecases"
)

func assetsTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(assetsOrphansTool(), wrapTool(invokeAssetsOrphans(deps)))
	srv.AddTool(assetsGCTool(), wrapTool(invokeAssetsGC(deps)))
}

func assetsOrphansTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"assets_orphans",
		mcpgo.WithDescription("List asset IDs not referenced by any post body. "+
			"Read-only; use assets_gc to actually delete."),
	)
}

func invokeAssetsOrphans(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		ids, err := usecases.FindOrphanAssets(
			ctx, deps.Assets.Repo, deps.Posts.Posts, ownerID,
		)
		if err != nil {
			deps.Log.Error("mcp assets_orphans", "err", err)
			return mcpgo.NewToolResultError("scan orphan assets failed")
		}
		return marshalResult(deps, orphansPayload{Orphans: ids})
	}
}

func assetsGCTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"assets_gc",
		mcpgo.WithDescription("Delete every asset not referenced by any post body. "+
			"Returns {deleted, failed} ID lists. Use assets_orphans first to preview."),
	)
}

func invokeAssetsGC(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		res, err := usecases.GCOrphanAssets(
			ctx, deps.Assets, deps.Posts.Posts, ownerID,
		)
		if err != nil {
			deps.Log.Error("mcp assets_gc", "err", err)
			return mcpgo.NewToolResultError("gc orphan assets failed")
		}
		return marshalResult(deps, gcPayload{Deleted: res.Deleted, Failed: res.FailedDeletes})
	}
}

type orphansPayload struct {
	Orphans []string `json:"orphans"`
}

func (p orphansPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal orphans payload: %w", err)
	}
	return b, nil
}

type gcPayload struct {
	Deleted []string `json:"deleted"`
	Failed  []string `json:"failed"`
}

func (p gcPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal gc payload: %w", err)
	}
	return b, nil
}
