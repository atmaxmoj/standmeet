// custom_page_lifecycle_tools.go —— custom_page.{promote_to_staging,
// promote_to_live, rollback, delete, list} 五个 MCP tool 的定义 + 调度。
// 跟 custom_page_tools.go（create / write_file / build / get_build）
// 同包；这里拆出来是因为合到一起会超过 350 行 max-lines。

package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

func promoteStagingTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.promote_to_staging",
		mcpgo.WithDescription("Promote a built build to staging (owner-visible preview)."),
		mcpgo.WithString(customPageSlugArg, mcpgo.Required()),
		mcpgo.WithString("build_id", mcpgo.Required()),
	)
}

func invokePromoteStaging(deps *Deps) invokeFn {
	return promoteHelper(deps, "custom_page.promote_to_staging", usecases.PromoteToStaging)
}

func promoteLiveTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.promote_to_live",
		mcpgo.WithDescription("Promote a built build to live (visitor-facing)."),
		mcpgo.WithString(customPageSlugArg, mcpgo.Required()),
		mcpgo.WithString("build_id", mcpgo.Required()),
	)
}

func invokePromoteLive(deps *Deps) invokeFn {
	return promoteHelper(deps, "custom_page.promote_to_live", usecases.PromoteToLive)
}

type promoteFn func(
	ctx context.Context, deps usecases.CustomPageDeps,
	ownerID, slug, buildID string,
) (domain.CustomPage, error)

func promoteHelper(deps *Deps, name string, fn promoteFn) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		slug, e1 := req.RequireString(customPageSlugArg)
		buildID, e2 := req.RequireString("build_id")
		if e1 != nil || e2 != nil {
			return mcpgo.NewToolResultError("slug + build_id required")
		}
		page, err := fn(ctx, deps.CustomPages, ownerID, slug, buildID)
		if err != nil {
			return customPageErr(deps, err, name)
		}
		return marshalResult(deps, pagePayload{ID: page.ID, Slug: page.Slug, Title: page.Title})
	}
}

func rollbackTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.rollback",
		mcpgo.WithDescription("Revert live to the previous build. No-op if no previous."),
		mcpgo.WithString(customPageSlugArg, mcpgo.Required()),
	)
}

func invokeRollback(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		slug, rerr := req.RequireString(customPageSlugArg)
		if rerr != nil {
			return mcpgo.NewToolResultError("slug is required")
		}
		page, err := usecases.Rollback(ctx, deps.CustomPages, ownerID, slug)
		if err != nil {
			return customPageErr(deps, err, "custom_page.rollback")
		}
		return marshalResult(deps, pagePayload{ID: page.ID, Slug: page.Slug, Title: page.Title})
	}
}

func deletePageTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.delete",
		mcpgo.WithDescription("Soft-delete a custom page (status='deleted')."),
		mcpgo.WithString(customPageSlugArg, mcpgo.Required()),
	)
}

func invokeDeletePage(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		slug, rerr := req.RequireString(customPageSlugArg)
		if rerr != nil {
			return mcpgo.NewToolResultError("slug is required")
		}
		if err := usecases.DeletePage(ctx, deps.CustomPages, ownerID, slug); err != nil {
			return customPageErr(deps, err, "custom_page.delete")
		}
		return mcpgo.NewToolResultText(`{"ok":true}`)
	}
}

func listPagesTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.list",
		mcpgo.WithDescription("List the owner's custom pages."),
	)
}

type listPayload struct {
	Pages []pagePayload `json:"pages"`
}

func (l listPayload) marshalJSON() ([]byte, error) {
	out, err := json.Marshal(l)
	if err != nil {
		return nil, fmt.Errorf("marshal list payload: %w", err)
	}
	return out, nil
}

func invokeListPages(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		pages, err := usecases.ListPages(ctx, deps.CustomPages, ownerID)
		if err != nil {
			return customPageErr(deps, err, "custom_page.list")
		}
		items := make([]pagePayload, 0, len(pages))
		for i := range pages {
			items = append(items, pagePayload{
				ID: pages[i].ID, Slug: pages[i].Slug, Title: pages[i].Title,
			})
		}
		return marshalResult(deps, listPayload{Pages: items})
	}
}
