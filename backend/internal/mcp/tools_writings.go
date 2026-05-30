// tools_writings.go —— writings MCP write tools。
//
// owner 在 Claude Desktop 让 AI 写一篇 essay → AI 调 writing_create 一次落
// 库；publish=true 直接发布。body 直接接 markdown，AI 原生吐什么就存什么；
// 不发明 block JSON 中间形态。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

func writingsTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(writingCreateTool(), wrapTool(invokeWritingCreate(deps)))
	srv.AddTool(writingListTool(), wrapTool(invokeWritingList(deps)))
	srv.AddTool(writingPublishTool(), wrapTool(invokeWritingPublish(deps)))
	srv.AddTool(writingDeleteTool(), wrapTool(invokeWritingDelete(deps)))
}

func writingCreateTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"writing_create",
		mcpgo.WithDescription("Write a long-form piece to the owner's /writings. body_md "+
			"is GitHub-flavored markdown (headings, lists, tables, code blocks, links, "+
			"blockquotes, images, etc.) and is rendered as-is on the public page. "+
			"publish=true makes it visible immediately; otherwise it lands as a draft."),
		mcpgo.WithString("slug", mcpgo.Required(),
			mcpgo.Description("URL slug, unique per owner (e.g. 'evaluation-is-the-product').")),
		mcpgo.WithString("title", mcpgo.Required(), mcpgo.Description("Writing title.")),
		mcpgo.WithString("excerpt", mcpgo.Description("Short summary shown on index + chat.")),
		mcpgo.WithString("body_md",
			mcpgo.Description("GitHub-flavored markdown body. Stored as-is, rendered "+
				"via remark-gfm on the public page.")),
		mcpgo.WithString("cover_headline", mcpgo.Description("Big serif headline on the cover.")),
		mcpgo.WithString("cover_sub", mcpgo.Description("Italic sub on the cover.")),
		mcpgo.WithString("cover_hue",
			mcpgo.Description("'amber' (default) | 'violet' | 'acid'.")),
		mcpgo.WithString("cover_image_asset_id",
			mcpgo.Description("Optional asset id from upload_media for a real cover image.")),
		mcpgo.WithArray("tags", mcpgo.Description("Tag chips, lowercase.")),
		mcpgo.WithString("visibility",
			mcpgo.Description("'public' (default) | 'private' (needs code with allow rule).")),
		mcpgo.WithArray("cross_refs",
			mcpgo.Description("Slugs of related writings shown in 'read next'.")),
		mcpgo.WithString("locked_body",
			mcpgo.Description("Teaser shown to visitors without code (for private writings).")),
		mcpgo.WithBoolean("publish",
			mcpgo.Description("true = publish immediately; false (default) = draft.")),
		mcpgo.WithArray("files",
			mcpgo.Description(
				"Inline image uploads, each {pending_id, url}. body_md / cover_image_asset_id "+
					"reference them as 'standmeet-asset:pending-<id>' / 'pending-<id>'. Server "+
					"fetches each URL (https only, image/* content-type) and atomically saves "+
					"the bytes alongside the writing.")),
	)
}

func invokeWritingCreate(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		in, perr := parseWritingCreateParams(ctx, req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		return runWritingCreate(ctx, deps, in)
	}
}

func parseWritingCreateParams(
	ctx context.Context, req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.SaveWritingInput, error) {
	slug, err := req.RequireString("slug")
	if err != nil {
		return nil, errors.New("slug is required")
	}
	title, err := req.RequireString("title")
	if err != nil {
		return nil, errors.New("title is required")
	}
	in := buildWritingCreateInput(req, ownerID, slug, title)
	files, ferr := parseOptionalFilesArg(ctx, req)
	if ferr != nil {
		return nil, ferr
	}
	in.Files = files
	return in, nil
}

func parseOptionalFilesArg(
	ctx context.Context, req *mcpgo.CallToolRequest,
) ([]usecases.FileInput, error) {
	raw, ok := req.GetArguments()["files"]
	if !ok || raw == nil {
		return []usecases.FileInput{}, nil
	}
	return resolveMCPFiles(ctx, raw)
}

func buildWritingCreateInput(
	req *mcpgo.CallToolRequest, ownerID, slug, title string,
) *usecases.SaveWritingInput {
	return &usecases.SaveWritingInput{
		OwnerID: ownerID, Slug: slug, Title: title,
		Excerpt:       req.GetString("excerpt", ""),
		BodyMD:        req.GetString("body_md", ""),
		CoverImageRef: req.GetString("cover_image_asset_id", ""),
		CoverHeadline: req.GetString("cover_headline", ""),
		CoverSub:      req.GetString("cover_sub", ""),
		CoverHue:      req.GetString("cover_hue", "amber"),
		Tags:          req.GetStringSlice("tags", nil),
		Visibility:    req.GetString("visibility", "public"),
		CrossRefs:     req.GetStringSlice("cross_refs", nil),
		LockedBody:    req.GetString("locked_body", ""),
		Publish:       req.GetBool("publish", false),
		// Files 空：MCP path 不接 binary upload，AI 写的 body_md 不应含
		// standmeet-asset:pending- 占位（无地方上传）。已存在 asset 也不能
		// 跨 writing 引用（每张 asset 挂一个 holder）。
	}
}

func runWritingCreate(
	ctx context.Context, deps *Deps, in *usecases.SaveWritingInput,
) *mcpgo.CallToolResult {
	wg, err := usecases.SaveWriting(ctx, deps.WritingsTx, in)
	if err != nil {
		if errors.Is(err, domain.ErrWritingSlugTaken) {
			return mcpgo.NewToolResultError("writing slug already taken")
		}
		deps.Log.Error("mcp writing_create", "err", err)
		return mcpgo.NewToolResultError("create writing failed")
	}
	return marshalResult(deps, writingIDPayload{
		WritingID: wg.ID(), Slug: wg.Slug(), Published: wg.IsPublished(),
	})
}

func writingListTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"writing_list",
		mcpgo.WithDescription("List all writings (drafts + published, newest first)."),
	)
}

func invokeWritingList(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		rows, err := usecases.ListAllWritings(ctx, deps.Writings, ownerID)
		if err != nil {
			deps.Log.Error("mcp writing_list", "err", err)
			return mcpgo.NewToolResultError("list writings failed")
		}
		return marshalResult(deps, writingListView(rows))
	}
}

func writingPublishTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"writing_publish",
		mcpgo.WithDescription("Publish a draft writing (sets published_at=now)."),
		mcpgo.WithString("writing_id", mcpgo.Required(),
			mcpgo.Description("Writing id from writing_create / writing_list.")),
	)
}

func invokeWritingPublish(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		writingID, err := req.RequireString("writing_id")
		if err != nil {
			return mcpgo.NewToolResultError("writing_id is required")
		}
		wg, perr := usecases.PublishWriting(ctx, deps.Writings, ownerID, writingID)
		if perr != nil {
			deps.Log.Error("mcp writing_publish", "err", perr)
			return mcpgo.NewToolResultError("publish writing failed")
		}
		return marshalResult(deps, writingIDPayload{
			WritingID: wg.ID(), Slug: wg.Slug(), Published: true,
		})
	}
}

func writingDeleteTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"writing_delete",
		mcpgo.WithDescription("Delete a writing."),
		mcpgo.WithString("writing_id", mcpgo.Required(),
			mcpgo.Description("Writing id from writing_create / writing_list.")),
	)
}

func invokeWritingDelete(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		writingID, err := req.RequireString("writing_id")
		if err != nil {
			return mcpgo.NewToolResultError("writing_id is required")
		}
		derr := usecases.DeleteWritingWithAssets(ctx, deps.WritingsTx, ownerID, writingID)
		if derr != nil {
			deps.Log.Error("mcp writing_delete", "err", derr)
			return mcpgo.NewToolResultError("delete writing failed")
		}
		return marshalResult(deps, writingIDPayload{WritingID: writingID})
	}
}

// ---- payload ----------------------------------------------------------

type writingIDPayload struct {
	WritingID string `json:"writing_id"`
	Slug      string `json:"slug,omitempty"`
	Published bool   `json:"published,omitempty"`
}

func (p writingIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal writing id payload: %w", err)
	}
	return b, nil
}

type writingView struct {
	PublishedAt string   `json:"published_at,omitempty"`
	UpdatedAt   string   `json:"updated_at"`
	ID          string   `json:"id"`
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Excerpt     string   `json:"excerpt,omitempty"`
	Visibility  string   `json:"visibility"`
	Tags        []string `json:"tags"`
	Published   bool     `json:"published"`
}

func writingListView(rows []domain.Writing) writingListPayload {
	out := make(writingListPayload, 0, len(rows))
	for i := range rows {
		var pubAtPtr *time.Time
		if pub, ok := rows[i].PublishedAt(); ok {
			cp := pub
			pubAtPtr = &cp
		}
		out = append(out, writingView{
			ID: rows[i].ID(), Slug: rows[i].Slug(), Title: rows[i].Title(),
			Excerpt: rows[i].Excerpt(), Visibility: rows[i].VisibilityMode(),
			Tags: rows[i].Tags(), Published: rows[i].IsPublished(),
			PublishedAt: usecases.PublishedAtRFC3339(pubAtPtr),
			UpdatedAt:   rows[i].UpdatedAt().Format(mcpTimeFmt),
		})
	}
	return out
}

type writingListPayload []writingView

func (p writingListPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal writing list payload: %w", err)
	}
	return b, nil
}
