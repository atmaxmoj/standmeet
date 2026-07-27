// cap_custom_page_lifecycle.go —— Phase E-14a: custom_page lifecycle bindings
// 拆出 cap_custom_page.go 守 max-lines 350。
//
// 5 tools: promote_to_staging / promote_to_live / rollback / delete / list。

package ownercore

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// ───── promote_to_staging ──────────────────────────────────────

func (c *customPageCapability) promoteStagingBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.promote_to_staging",
		Description: "Promote a built build to staging (owner-visible preview).",
		InputSchema: promoteToBuildIDSchema(),
		Handler: c.handlePromote(
			"custom_page.promote_to_staging", owner.PromoteToStaging,
		),
	}
}

// ───── promote_to_live ────────────────────────────────────────

func (c *customPageCapability) promoteLiveBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.promote_to_live",
		Description: "Promote a built build to live (visitor-facing).",
		InputSchema: promoteToBuildIDSchema(),
		Handler: c.handlePromote(
			"custom_page.promote_to_live", owner.PromoteToLive,
		),
	}
}

func promoteToBuildIDSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"build_id":{"type":"string"}
		},
		"required":["slug","build_id"]
	}`)
}

type promoteArgsWire struct {
	Slug    string `json:"slug"`
	BuildID string `json:"build_id"`
}

type promoteUsecaseFn func(
	ctx context.Context, deps owner.CustomPageDeps,
	ownerID, slug, buildID string,
) (owner.CustomPage, error)

func (c *customPageCapability) handlePromote(
	name string, fn promoteUsecaseFn,
) capreg.MCPHandler {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) capreg.MCPResult {
		var args promoteArgsWire
		if err := json.Unmarshal(raw, &args); err != nil {
			return capreg.MCPError("invalid arguments: " + err.Error())
		}
		if args.Slug == "" || args.BuildID == "" {
			return capreg.MCPError("slug + build_id required")
		}
		page, err := fn(ctx, *c.pages, ownerID, args.Slug, args.BuildID)
		if err != nil {
			return customPageCapErr(c.log, err, name)
		}
		return mcputil.MarshalResult(c.log, name, capPageView(&page))
	}
}

// ───── rollback ────────────────────────────────────────────────

func (c *customPageCapability) rollbackBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.rollback",
		Description: "Revert live to the previous build. No-op if no previous.",
		InputSchema: slugOnlySchema(),
		Handler:     c.handleRollback,
	}
}

func slugOnlySchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"}
		},
		"required":["slug"]
	}`)
}

func (c *customPageCapability) handleRollback(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args slugOnlyArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Slug == "" {
		return capreg.MCPError("slug is required")
	}
	page, err := owner.Rollback(ctx, *c.pages, ownerID, args.Slug)
	if err != nil {
		return customPageCapErr(c.log, err, "custom_page.rollback")
	}
	return mcputil.MarshalResult(c.log, "custom_page.rollback", capPageView(&page))
}

// ───── delete ─────────────────────────────────────────────────

func (c *customPageCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.delete",
		Description: "Soft-delete a custom page (status='deleted').",
		InputSchema: slugOnlySchema(),
		Handler:     c.handleDelete,
	}
}

func (c *customPageCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args slugOnlyArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Slug == "" {
		return capreg.MCPError("slug is required")
	}
	if err := owner.DeletePage(ctx, *c.pages, ownerID, args.Slug); err != nil {
		return customPageCapErr(c.log, err, "custom_page.delete")
	}
	return mcputil.MarshalResult(c.log, "custom_page.delete", map[string]bool{"ok": true})
}

// ───── list ────────────────────────────────────────────────────

func (c *customPageCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.list",
		Description: "List the owner's custom pages.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

func (c *customPageCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	pages, err := owner.ListPages(ctx, *c.pages, ownerID)
	if err != nil {
		return customPageCapErr(c.log, err, "custom_page.list")
	}
	items := make([]capPageViewT, 0, len(pages))
	for i := range pages {
		items = append(items, capPageView(&pages[i]))
	}
	return mcputil.MarshalResult(c.log, "custom_page.list",
		map[string]any{"pages": items})
}
