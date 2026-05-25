// tools_posts.go —— blog posts MCP write tools。
//
// owner 在 Claude Desktop 让 AI 写一篇 essay → AI 调 post_create 一次落
// 库；publish=true 直接发布。body 直接接 markdown，AI 原生吐什么就存什么；
// 不发明 block JSON 中间形态。

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

func postsTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(postCreateTool(), wrapTool(invokePostCreate(deps)))
	srv.AddTool(postListTool(), wrapTool(invokePostList(deps)))
	srv.AddTool(postPublishTool(), wrapTool(invokePostPublish(deps)))
	srv.AddTool(postDeleteTool(), wrapTool(invokePostDelete(deps)))
}

func postCreateTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"post_create",
		mcpgo.WithDescription("Write a blog post to the owner's /blog. body_md is "+
			"GitHub-flavored markdown (headings, lists, tables, code blocks, links, "+
			"blockquotes, images, etc.) and is rendered as-is on the public page. "+
			"publish=true makes it visible immediately; otherwise it lands as a draft."),
		mcpgo.WithString("slug", mcpgo.Required(),
			mcpgo.Description("URL slug, unique per owner (e.g. 'evaluation-is-the-product').")),
		mcpgo.WithString("title", mcpgo.Required(), mcpgo.Description("Post title.")),
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
			mcpgo.Description("Slugs of related posts shown in 'read next'.")),
		mcpgo.WithString("locked_body",
			mcpgo.Description("Teaser shown to visitors without code (for private posts).")),
		mcpgo.WithBoolean("publish",
			mcpgo.Description("true = publish immediately; false (default) = draft.")),
		mcpgo.WithArray("files",
			mcpgo.Description(
				"Inline image uploads, each {pending_id, url}. body_md / cover_image_asset_id "+
					"reference them as 'standmeet-asset:pending-<id>' / 'pending-<id>'. Server "+
					"fetches each URL (https only, image/* content-type) and atomically saves "+
					"the bytes alongside the post.")),
	)
}

func invokePostCreate(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		in, perr := parsePostCreateParams(ctx, req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		return runPostCreate(ctx, deps, in)
	}
}

func parsePostCreateParams(
	ctx context.Context, req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.SavePostInput, error) {
	slug, err := req.RequireString("slug")
	if err != nil {
		return nil, errors.New("slug is required")
	}
	title, err := req.RequireString("title")
	if err != nil {
		return nil, errors.New("title is required")
	}
	in := buildPostCreateInput(req, ownerID, slug, title)
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
		return nil, nil
	}
	return resolveMCPFiles(ctx, raw)
}

func buildPostCreateInput(
	req *mcpgo.CallToolRequest, ownerID, slug, title string,
) *usecases.SavePostInput {
	return &usecases.SavePostInput{
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
		// 跨 post 引用（每张 asset 挂一个 holder）。
	}
}

func runPostCreate(
	ctx context.Context, deps *Deps, in *usecases.SavePostInput,
) *mcpgo.CallToolResult {
	post, err := usecases.SavePost(ctx, deps.PostsTx, in)
	if err != nil {
		if errors.Is(err, domain.ErrPostSlugTaken) {
			return mcpgo.NewToolResultError("post slug already taken")
		}
		deps.Log.Error("mcp post_create", "err", err)
		return mcpgo.NewToolResultError("create post failed")
	}
	return marshalResult(deps, postIDPayload{
		PostID: post.ID, Slug: post.Slug, Published: post.IsPublished(),
	})
}

func postListTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"post_list",
		mcpgo.WithDescription("List all blog posts (drafts + published, newest first)."),
	)
}

func invokePostList(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		rows, err := usecases.ListAllPosts(ctx, deps.Posts, ownerID)
		if err != nil {
			deps.Log.Error("mcp post_list", "err", err)
			return mcpgo.NewToolResultError("list posts failed")
		}
		return marshalResult(deps, postListView(rows))
	}
}

func postPublishTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"post_publish",
		mcpgo.WithDescription("Publish a draft post (sets published_at=now)."),
		mcpgo.WithString("post_id", mcpgo.Required(),
			mcpgo.Description("Post id from post_create / post_list.")),
	)
}

func invokePostPublish(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		postID, err := req.RequireString("post_id")
		if err != nil {
			return mcpgo.NewToolResultError("post_id is required")
		}
		post, perr := usecases.PublishPost(ctx, deps.Posts, ownerID, postID)
		if perr != nil {
			deps.Log.Error("mcp post_publish", "err", perr)
			return mcpgo.NewToolResultError("publish post failed")
		}
		return marshalResult(deps, postIDPayload{
			PostID: post.ID, Slug: post.Slug, Published: true,
		})
	}
}

func postDeleteTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"post_delete",
		mcpgo.WithDescription("Delete a blog post."),
		mcpgo.WithString("post_id", mcpgo.Required(),
			mcpgo.Description("Post id from post_create / post_list.")),
	)
}

func invokePostDelete(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		postID, err := req.RequireString("post_id")
		if err != nil {
			return mcpgo.NewToolResultError("post_id is required")
		}
		if derr := usecases.DeletePostWithAssets(ctx, deps.PostsTx, ownerID, postID); derr != nil {
			deps.Log.Error("mcp post_delete", "err", derr)
			return mcpgo.NewToolResultError("delete post failed")
		}
		return marshalResult(deps, postIDPayload{PostID: postID})
	}
}

// ---- payload ----------------------------------------------------------

type postIDPayload struct {
	PostID    string `json:"post_id"`
	Slug      string `json:"slug,omitempty"`
	Published bool   `json:"published,omitempty"`
}

func (p postIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal post id payload: %w", err)
	}
	return b, nil
}

type postView struct {
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

func postListView(rows []domain.Post) postListPayload {
	out := make(postListPayload, 0, len(rows))
	for i := range rows {
		out = append(out, postView{
			ID: rows[i].ID, Slug: rows[i].Slug, Title: rows[i].Title,
			Excerpt: rows[i].Excerpt, Visibility: rows[i].Visibility,
			Tags: rows[i].Tags, Published: rows[i].IsPublished(),
			PublishedAt: usecases.PublishedAtRFC3339(rows[i].PublishedAt),
			UpdatedAt:   rows[i].UpdatedAt.Format(mcpTimeFmt),
		})
	}
	return out
}

type postListPayload []postView

func (p postListPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal post list payload: %w", err)
	}
	return b, nil
}
