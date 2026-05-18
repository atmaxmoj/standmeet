// custom_page_tools.go —— owner 的 AI client 通过 MCP 创建 / 编辑 / 发布
// 自定义页面。
//
// 8 个 tool：
//   custom_page.create(slug, title?)
//   custom_page.write_file(slug, path, content)
//   custom_page.build(slug)           —— 显式触发；返 build_id 供 poll
//   custom_page.get_build(build_id)   —— status / output / error
//   custom_page.promote_to_staging(slug, build_id)
//   custom_page.promote_to_live(slug, build_id)
//   custom_page.rollback(slug)
//   custom_page.delete(slug)
//   custom_page.list()

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

const (
	customPageSlugArg = "slug"
	mcpUnauthorized   = "unauthorized"
)

func customPageTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(createPageTool(), wrapTool(invokeCreatePage(deps)))
	srv.AddTool(writeFileTool(), wrapTool(invokeWriteFile(deps)))
	srv.AddTool(buildPageTool(), wrapTool(invokeBuildPage(deps)))
	srv.AddTool(getBuildTool(), wrapTool(invokeGetBuild(deps)))
	srv.AddTool(promoteStagingTool(), wrapTool(invokePromoteStaging(deps)))
	srv.AddTool(promoteLiveTool(), wrapTool(invokePromoteLive(deps)))
	srv.AddTool(rollbackTool(), wrapTool(invokeRollback(deps)))
	srv.AddTool(deletePageTool(), wrapTool(invokeDeletePage(deps)))
	srv.AddTool(listPagesTool(), wrapTool(invokeListPages(deps)))
}

// --- create ---------------------------------------------------------------

func createPageTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.create",
		mcpgo.WithDescription("Create a new custom page under /<handle>/p/<slug>."),
		mcpgo.WithString(customPageSlugArg, mcpgo.Required(),
			mcpgo.Description("URL slug: a-z0-9- (e.g. 'blog').")),
		mcpgo.WithString("title",
			mcpgo.Description("Display title (optional, owner can edit later).")),
	)
}

type pagePayload struct {
	ID    string `json:"id"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

func (p pagePayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal page payload: %w", err)
	}
	return b, nil
}

func invokeCreatePage(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		slug, rerr := req.RequireString(customPageSlugArg)
		if rerr != nil {
			return mcpgo.NewToolResultError("slug is required")
		}
		page, err := usecases.CreatePage(ctx, deps.CustomPages, &usecases.CreatePageInput{
			OwnerID: ownerID, Slug: slug, Title: req.GetString("title", slug),
		})
		if err != nil {
			return customPageErr(deps, err, "custom_page.create")
		}
		return marshalResult(deps, pagePayload{ID: page.ID, Slug: page.Slug, Title: page.Title})
	}
}

// --- write_file -----------------------------------------------------------

func writeFileTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.write_file",
		mcpgo.WithDescription("Add or overwrite a source file in the page draft."),
		mcpgo.WithString(customPageSlugArg, mcpgo.Required()),
		mcpgo.WithString("path", mcpgo.Required(),
			mcpgo.Description("Relative path (e.g. 'App.tsx').")),
		mcpgo.WithString("content", mcpgo.Required(),
			mcpgo.Description("File body. Max 64 KiB.")),
	)
}

type buildPayload struct {
	BuildID      string `json:"build_id"`
	PageID       string `json:"page_id"`
	Status       string `json:"status"`
	OutputPath   string `json:"output_path"`
	ErrorMessage string `json:"error_message"`
}

func (b *buildPayload) marshalJSON() ([]byte, error) {
	out, err := json.Marshal(b)
	if err != nil {
		return nil, fmt.Errorf("marshal build payload: %w", err)
	}
	return out, nil
}

func invokeWriteFile(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		in, perr := parseWriteFileArgs(req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		build, err := usecases.WriteFile(ctx, deps.CustomPages, in)
		if err != nil {
			return customPageErr(deps, err, "custom_page.write_file")
		}
		return marshalResult(deps, toBuildPayload(&build))
	}
}

func parseWriteFileArgs(
	req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.WriteFileInput, error) {
	slug, e1 := req.RequireString(customPageSlugArg)
	path, e2 := req.RequireString("path")
	content, e3 := req.RequireString("content")
	if e1 != nil || e2 != nil || e3 != nil {
		return nil, errors.New("slug + path + content required")
	}
	return &usecases.WriteFileInput{
		OwnerID: ownerID, Slug: slug, Path: path, Content: content,
	}, nil
}

func toBuildPayload(b *domain.CustomPageBuild) *buildPayload {
	return &buildPayload{
		BuildID:      b.ID,
		PageID:       b.PageID,
		Status:       b.Status,
		OutputPath:   b.OutputPath,
		ErrorMessage: b.ErrorMessage,
	}
}

// --- build / get_build ----------------------------------------------------

func buildPageTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.build",
		mcpgo.WithDescription("Trigger / surface the current draft build. Builder is async."),
		mcpgo.WithString(customPageSlugArg, mcpgo.Required()),
	)
}

func invokeBuildPage(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		slug, rerr := req.RequireString(customPageSlugArg)
		if rerr != nil {
			return mcpgo.NewToolResultError("slug is required")
		}
		build, err := usecases.Build(ctx, deps.CustomPages, ownerID, slug)
		if err != nil {
			return customPageErr(deps, err, "custom_page.build")
		}
		return marshalResult(deps, toBuildPayload(&build))
	}
}

func getBuildTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"custom_page.get_build",
		mcpgo.WithDescription("Poll a build for status: pending → building → built|failed."),
		mcpgo.WithString("build_id", mcpgo.Required()),
	)
}

func invokeGetBuild(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(mcpUnauthorized)
		}
		buildID, rerr := req.RequireString("build_id")
		if rerr != nil {
			return mcpgo.NewToolResultError("build_id is required")
		}
		build, err := usecases.GetBuild(ctx, deps.CustomPages, buildID)
		if err != nil {
			return customPageErr(deps, err, "custom_page.get_build")
		}
		return marshalResult(deps, toBuildPayload(&build))
	}
}

// --- error translation ----------------------------------------------------
//
// promote_to_staging / promote_to_live / rollback / delete / list 五个
// lifecycle tool 拆到 custom_page_lifecycle_tools.go，避免单文件超 350 行。

func customPageErr(deps *Deps, err error, name string) *mcpgo.CallToolResult {
	switch {
	case errors.Is(err, domain.ErrCustomPageNotFound):
		return mcpgo.NewToolResultError("page not found")
	case errors.Is(err, domain.ErrCustomPageBuildNotFound):
		return mcpgo.NewToolResultError("build not found")
	case errors.Is(err, domain.ErrCustomPageSlugTaken):
		return mcpgo.NewToolResultError("slug already taken")
	}
	deps.Log.Error(name, "err", err)
	return mcpgo.NewToolResultError(name + " failed: " + err.Error())
}
