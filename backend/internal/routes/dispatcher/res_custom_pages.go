// res_custom_pages.go —— 资源 custom_pages:owner 自己写的 React 页面。
//
// 写这一组是**故意只在 MCP 上**的:页面是写代码写出来的,owner 在 AI 客户端里写文件、
// 触发构建、看构建结果,面板给不了这条路径。所以除了列表,每个 op 的 Reach 都写明只在 MCP。
// 这不是欠账,是产品决定 —— 写在 Reach 里,棘轮就不会有一天"帮"它长出一个 admin 孪生。
//
// 列表两个面都有,而且以前两份不一样:面板那份带状态、live/staging 有没有、时间戳
// (owner 靠它判断"发出去没有"),MCP 那份只有 id/slug/title,还多包了一层 {pages:[...]}。
// 现在一份,就是面板那份的内容。

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CustomPage —— 一个自定义页在出站这一层的形状。
type CustomPage struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	LiveBuildID string `json:"live_build_id,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	HasLive     bool   `json:"has_live"`
	HasStaging  bool   `json:"has_staging"`
}

// CustomPageBuild —— 一次构建。builder 是异步的,所以 owner 拿 build_id 轮询状态。
type CustomPageBuild struct {
	BuildID      string `json:"build_id"`
	PageID       string `json:"page_id"`
	Status       string `json:"status"`
	OutputPath   string `json:"output_path"`
	ErrorMessage string `json:"error_message"`
}

// CustomPageStore —— custom_pages 这组操作所需的最小口。
type CustomPageStore interface {
	List(ctx context.Context, ownerID string) ([]CustomPage, error)
	Create(ctx context.Context, ownerID, slug, title string) (CustomPage, error)
	WriteFile(ctx context.Context, ownerID, slug, path, content string) (CustomPageBuild, error)
	Build(ctx context.Context, ownerID, slug string) (CustomPageBuild, error)
	GetBuild(ctx context.Context, buildID string) (CustomPageBuild, error)
	PromoteToStaging(ctx context.Context, ownerID, slug, buildID string) (CustomPage, error)
	PromoteToLive(ctx context.Context, ownerID, slug, buildID string) (CustomPage, error)
	Rollback(ctx context.Context, ownerID, slug string) (CustomPage, error)
	Delete(ctx context.Context, ownerID, slug string) error
}

// CustomPages —— custom_pages 资源。
func CustomPages(store CustomPageStore) Resource {
	return Resource{
		Name: "custom_pages",
		Ops:  append(customPageReadOps(store), customPageAuthorOps(store)...),
	}
}

// authoringOnMCP —— 写这一组只在 MCP 上,理由写在这儿一次。
func authoringOnMCP() fp.Reach {
	return fp.Only(
		"authoring a custom page means writing code and driving the sandbox builder; "+
			"the panel has no such surface", "mcp")
}

func customPageReadOps(store CustomPageStore) []Op {
	return []Op{
		{
			ID: "custom_page.list",
			Description: "List the owner's custom pages with what is live, what is waiting " +
				"in staging, and when each was last touched.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      customPageList(store),
		},
		{
			ID:          "custom_page.get_build",
			Description: "Poll one build: pending → building → built | failed.",
			InputSchema: buildIDSchema,
			Kind:        fp.Read,
			Reach:       authoringOnMCP(),
			Invoke:      customPageGetBuild(store),
		},
	}
}

func customPageAuthorOps(store CustomPageStore) []Op {
	return []Op{
		{
			ID:          "custom_page.create",
			Description: "Create a custom page, served at /<handle>/p/<slug>.",
			InputSchema: customPageCreateSchema,
			Kind:        fp.Action,
			Reach:       authoringOnMCP(),
			Invoke:      customPageCreate(store),
		},
		{
			ID:          "custom_page.write_file",
			Description: "Add or overwrite one source file in the page's draft.",
			InputSchema: customPageFileSchema,
			Kind:        fp.Action,
			Reach:       authoringOnMCP(),
			Invoke:      customPageWriteFile(store),
		},
		{
			ID: "custom_page.build",
			Description: "Build the current draft. The builder is asynchronous — poll the " +
				"returned build id with custom_page.get_build.",
			InputSchema: customPageSlugSchema,
			Kind:        fp.Action,
			Reach:       authoringOnMCP(),
			Invoke:      customPageBuild(store),
		},
		{
			ID:          "custom_page.promote_to_staging",
			Description: "Put a finished build on staging, where only the owner can see it.",
			InputSchema: customPagePromoteSchema,
			Kind:        fp.Action,
			Reach:       authoringOnMCP(),
			Invoke:      customPagePromote(store.PromoteToStaging, "promote to staging"),
		},
		{
			ID:          "custom_page.promote_to_live",
			Description: "Put a finished build live, where visitors see it.",
			InputSchema: customPagePromoteSchema,
			Kind:        fp.Action,
			Reach:       authoringOnMCP(),
			Invoke:      customPagePromote(store.PromoteToLive, "promote to live"),
		},
		{
			ID:          "custom_page.rollback",
			Description: "Send live back to the previous build. No-op if there is none.",
			InputSchema: customPageSlugSchema,
			Kind:        fp.Action,
			Reach:       authoringOnMCP(),
			Invoke:      customPageRollback(store),
		},
		{
			ID:          "custom_page.delete",
			Description: "Delete a custom page.",
			InputSchema: customPageSlugSchema,
			Kind:        fp.Action,
			Reach:       authoringOnMCP(),
			Invoke:      customPageDelete(store),
		},
	}
}

var customPageCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"slug":{"type":"string","description":"URL slug: a-z0-9-."},
		"title":{"type":"string","description":"Display title; defaults to the slug."}
	},
	"required":["slug"]
}`)

var customPageFileSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"slug":{"type":"string"},
		"path":{"type":"string","description":"Relative path, e.g. 'App.tsx'."},
		"content":{"type":"string","description":"File body. Max 64 KiB."}
	},
	"required":["slug","path","content"]
}`)

var customPageSlugSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"slug":{"type":"string"}},
	"required":["slug"]
}`)

var customPagePromoteSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"slug":{"type":"string"},
		"build_id":{"type":"string"}
	},
	"required":["slug","build_id"]
}`)

var buildIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"build_id":{"type":"string"}},
	"required":["build_id"]
}`)
