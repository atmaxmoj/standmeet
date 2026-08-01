// custom_pages.go —— owner 自己写的 React 页面。
//
// 写这一组是**故意只在 MCP 上**的:页面是写代码写出来的,owner 在 AI 客户端里写文件、
// 触发构建、看构建结果,面板给不了这条路径。这不是欠账,是产品决定 —— 写在每条的 Reach 里,
// 棘轮就不会有一天"帮"它长出一个面板孪生。
//
// 列表两个面都有,以前两份不一样:面板那份带状态、live/staging 有没有、时间戳(owner 靠它
// 判断"发出去没有"),MCP 那份只有 id/slug/title,还多包一层 {pages:[...]}。现在一份。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// CustomPages —— 列表 + 写作(建 / 写文件 / 构建 / 查构建 / 上 staging / 上线 / 回滚 / 删)。
func CustomPages(deps usecase.CustomPageDeps) []fp.Op {
	return append(customPageReadOps(deps), customPageAuthoringOps(deps)...)
}

// authoringOnMCP —— 写这一组只在 MCP 上,理由写在这儿一次。
func authoringOnMCP() fp.Reach {
	return fp.Only(
		"authoring a custom page means writing code and driving the sandbox builder; "+
			"the panel has no such surface", "mcp")
}

func customPageReadOps(deps usecase.CustomPageDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "custom_page.list",
			Description: "List the owner's custom pages with what is live, what is waiting in " +
				"staging, and when each was last touched.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCustomPages(deps),
		},
		{
			ID:          "custom_page.get_build",
			Description: "Poll one build: pending → building → built | failed.",
			InputSchema: buildIDSchema,
			Kind:        fp.Read,
			Reach:       authoringOnMCP(),
			Invoke:      getCustomPageBuild(deps),
		},
	}
}

var (
	buildIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"build_id":{"type":"string"}},
		"required":["build_id"]
	}`)

	pageSlugSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"slug":{"type":"string"}},
		"required":["slug"]
	}`)

	pageCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string","description":"URL slug: a-z0-9-."},
			"title":{"type":"string","description":"Display title; defaults to the slug."}
		},
		"required":["slug"]
	}`)

	pageFileSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"path":{"type":"string","description":"Relative path, e.g. 'App.tsx'."},
			"content":{"type":"string","description":"File body. Max 64 KiB."}
		},
		"required":["slug","path","content"]
	}`)

	pagePromoteSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"build_id":{"type":"string"}
		},
		"required":["slug","build_id"]
	}`)
)

// customPageOut / buildOut —— 出站形状(两个面同一份)。
type customPageOut struct {
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

type buildOut struct {
	BuildID      string `json:"build_id"`
	PageID       string `json:"page_id"`
	Status       string `json:"status"`
	OutputPath   string `json:"output_path"`
	ErrorMessage string `json:"error_message"`
}

func toCustomPageOut(p *entity.CustomPage) customPageOut {
	v := customPageOut{
		ID: p.ID, Slug: p.Slug, Title: p.Title, Status: p.Status,
		HasLive: p.LiveBuildID != nil, HasStaging: p.StagingBuildID != nil,
		CreatedAt: p.CreatedAt.Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt.Format(time.RFC3339),
	}
	if p.LiveBuildID != nil {
		v.LiveBuildID = *p.LiveBuildID
	}
	return v
}

func toBuildOut(b *entity.CustomPageBuild) buildOut {
	return buildOut{
		BuildID: b.ID, PageID: b.PageID, Status: b.Status,
		OutputPath: b.OutputPath, ErrorMessage: b.ErrorMessage,
	}
}

func listCustomPages(deps usecase.CustomPageDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListPages(ctx, deps, ownerID)
		if err != nil {
			return nil, customPageErr(err)
		}
		out := make([]customPageOut, 0, len(rows))
		for i := range rows {
			out = append(out, toCustomPageOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

func getCustomPageBuild(deps usecase.CustomPageDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"build_id", in.BuildID}); err != nil {
			return nil, err
		}
		build, err := usecase.GetBuild(ctx, deps, in.BuildID)
		if err != nil {
			return nil, customPageErr(err)
		}
		return json.Marshal(toBuildOut(&build))
	}
}

// pageArgs —— 这一组共用的入参袋(每个操作只读它需要的那几个字段)。
type pageArgs struct {
	Slug    string `json:"slug"`
	Title   string `json:"title"`
	Path    string `json:"path"`
	Content string `json:"content"`
	BuildID string `json:"build_id"`
}

func decodePageArgs(raw json.RawMessage) (pageArgs, error) {
	var in pageArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func customPageErr(err error) error {
	for _, c := range customPageErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("custom page op", err)
}

var customPageErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrCustomPageNotFound, func() error {
		return fp.Coded(fp.NotFound("page not found"), "page_not_found")
	}},
	{entity.ErrCustomPageBuildNotFound, func() error {
		return fp.Coded(fp.NotFound("build not found"), "build_not_found")
	}},
	{entity.ErrCustomPageSlugTaken, func() error {
		return fp.Coded(fp.Conflict("slug already taken"), "slug_taken")
	}},
}
