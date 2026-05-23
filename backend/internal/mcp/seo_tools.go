// seo_tools.go —— MCP seo.* tools。让 owner 的 AI client 直接给某条 wiki
// 设 SEO slug / description / indexed，或调整 owner 全局 SEO settings。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
)

func seoTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(setWikiSlugTool(), wrapTool(invokeSetWikiSlug(deps)))
	srv.AddTool(updateSEOSettingsTool(), wrapTool(invokeUpdateSEOSettings(deps)))
}

// ---- seo.set_wiki_slug ----------------------------------------------------

func setWikiSlugTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"seo.set_wiki_slug",
		mcpgo.WithDescription("Set SEO slug / description / indexed for a wiki entry."),
		mcpgo.WithString("wiki_id", mcpgo.Required(),
			mcpgo.Description("Target wiki entry UUID.")),
		mcpgo.WithString("seo_slug",
			mcpgo.Description("URL slug (a-z0-9-). Empty string clears it.")),
		mcpgo.WithString("seo_description",
			mcpgo.Description("Meta description for search engines.")),
		mcpgo.WithBoolean("seo_indexed",
			mcpgo.Description("Should sitemap include this slug (default false).")),
	)
}

type setWikiSlugPayload struct {
	WikiID         string  `json:"wiki_id"`
	SEOSlug        *string `json:"seo_slug"`
	SEODescription string  `json:"seo_description"`
	SEOIndexed     bool    `json:"seo_indexed"`
}

func (p setWikiSlugPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal set_wiki_slug payload: %w", err)
	}
	return b, nil
}

// setWikiSlugArgs —— invoke 拆出来的入参打包，让 runSetWikiSlug 不超 5 args。
type setWikiSlugArgs struct {
	slug        *string
	wikiID      string
	description string
	indexed     bool
}

func invokeSetWikiSlug(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		wikiID, rerr := req.RequireString("wiki_id")
		if rerr != nil {
			return mcpgo.NewToolResultError("wiki_id is required")
		}
		return runSetWikiSlug(ctx, deps, &setWikiSlugArgs{
			wikiID:      wikiID,
			slug:        optionalSlug(req.GetString("seo_slug", "")),
			description: req.GetString("seo_description", ""),
			indexed:     req.GetBool("seo_indexed", false),
		})
	}
}

func optionalSlug(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func runSetWikiSlug(
	ctx context.Context, deps *Deps, args *setWikiSlugArgs,
) *mcpgo.CallToolResult {
	updated, err := deps.SEO.UpdateWikiPath(
		ctx, args.wikiID, args.slug, args.description, args.indexed,
	)
	if err != nil {
		return seoErrorResult(deps, err, "seo.set_wiki_slug")
	}
	return marshalResult(deps, setWikiSlugPayload{
		WikiID:         updated.ID,
		SEOSlug:        updated.Path,
		SEODescription: updated.SEODescription,
		SEOIndexed:     updated.SEOIndexed,
	})
}

// ---- seo.update_settings --------------------------------------------------

func updateSEOSettingsTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"seo.update_settings",
		mcpgo.WithDescription(
			"Update owner-wide SEO settings (robots, sitemap_extras, og_template).",
		),
		mcpgo.WithBoolean("index_robots",
			mcpgo.Description("Allow crawlers (default true).")),
		mcpgo.WithArray("sitemap_extras",
			mcpgo.Description("Extra absolute URLs to include in sitemap.")),
		mcpgo.WithString("og_template",
			mcpgo.Description("OG image template hint (text only).")),
	)
}

// 字段顺序按 fieldalignment：string + slice 在前（pointer-heavy），bool 末尾。
type updateSEOSettingsPayload struct {
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
	IndexRobots   bool     `json:"index_robots"`
}

func (p updateSEOSettingsPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal update_seo_settings payload: %w", err)
	}
	return b, nil
}

func invokeUpdateSEOSettings(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		extras := stringSliceArg(req, "sitemap_extras")
		in := &domain.SEOSettings{
			OwnerID:       ownerID,
			IndexRobots:   req.GetBool("index_robots", true),
			SitemapExtras: extras,
			OGTemplate:    req.GetString("og_template", ""),
		}
		saved, err := deps.SEO.UpsertSettings(ctx, in)
		if err != nil {
			return seoErrorResult(deps, err, "seo.update_settings")
		}
		return marshalResult(deps, updateSEOSettingsPayload{
			IndexRobots:   saved.IndexRobots,
			SitemapExtras: saved.SitemapExtras,
			OGTemplate:    saved.OGTemplate,
		})
	}
}

// stringSliceArg —— 从 MCP args 拿 string array；空 / 类型不对返 nil slice。
func stringSliceArg(req *mcpgo.CallToolRequest, key string) []string {
	raw := req.GetArguments()
	v, ok := raw[key]
	if !ok {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, sok := x.(string); sok {
			out = append(out, s)
		}
	}
	return out
}

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
