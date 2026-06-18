// cap_custom_page.go —— Phase E-14a: custom_page.* Capability。owner-only。
// 9 tools:
//   create / write_file / build / get_build / promote_to_staging /
//   promote_to_live / rollback / delete / list
//
// 拆出 cap_custom_page_lifecycle.go (promote_to_* / rollback / delete / list)
// 守 max-lines。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capCustomPageBundle = "custom_page.bundle"

type customPageCapability struct {
	pages *usecases.CustomPageDeps
	log   *slog.Logger
}

func newCustomPageCapability(
	pages *usecases.CustomPageDeps, log *slog.Logger,
) *customPageCapability {
	return &customPageCapability{pages: pages, log: log}
}

func (*customPageCapability) ID() string          { return capCustomPageBundle }
func (*customPageCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*customPageCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*customPageCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*customPageCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *customPageCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.createBinding(), c.writeFileBinding(),
		c.buildBinding(), c.getBuildBinding(),
		c.promoteStagingBinding(), c.promoteLiveBinding(),
		c.rollbackBinding(), c.deleteBinding(), c.listBinding(),
	}
}

// ───── custom_page.create ──────────────────────────────────────

func (c *customPageCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.create",
		Description: "Create a new custom page under /<handle>/p/<slug>.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"slug":{"type":"string","description":"URL slug: a-z0-9-"},
				"title":{"type":"string","description":"Display title (optional)."}
			},
			"required":["slug"]
		}`),
		Handler: c.handleCreate,
	}
}

type pageSlugArgs struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

func (c *customPageCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args pageSlugArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Slug == "" {
		return capreg.MCPError("slug is required")
	}
	title := args.Title
	if title == "" {
		title = args.Slug
	}
	page, err := usecases.CreatePage(ctx, *c.pages, &usecases.CreatePageInput{
		OwnerID: ownerID, Slug: args.Slug, Title: title,
	})
	if err != nil {
		return customPageCapErr(c.log, err, "custom_page.create")
	}
	return marshalCapResult(c.log, "custom_page.create", capPageView(&page))
}

// ───── custom_page.write_file ─────────────────────────────────

func (c *customPageCapability) writeFileBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.write_file",
		Description: "Add or overwrite a source file in the page draft.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"slug":{"type":"string"},
				"path":{"type":"string","description":"Relative path (e.g. 'App.tsx')."},
				"content":{"type":"string","description":"File body. Max 64 KiB."}
			},
			"required":["slug","path","content"]
		}`),
		Handler: c.handleWriteFile,
	}
}

type writeFileArgsWire struct {
	Slug    string `json:"slug"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

func (c *customPageCapability) handleWriteFile(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseWriteFileArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	build, err := usecases.WriteFile(ctx, *c.pages, &usecases.WriteFileInput{
		OwnerID: ownerID, Slug: args.Slug, Path: args.Path, Content: args.Content,
	})
	if err != nil {
		return customPageCapErr(c.log, err, "custom_page.write_file")
	}
	return marshalCapResult(c.log, "custom_page.write_file", capBuildView(&build))
}

func parseWriteFileArgs(raw json.RawMessage) (writeFileArgsWire, error) {
	var args writeFileArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Slug == "" || args.Path == "" || args.Content == "" {
		return args, errors.New("slug + path + content required")
	}
	return args, nil
}

// ───── custom_page.build ────────────────────────────────────────

func (c *customPageCapability) buildBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.build",
		Description: "Trigger / surface the current draft build. Builder is async.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"slug":{"type":"string"}
			},
			"required":["slug"]
		}`),
		Handler: c.handleBuild,
	}
}

type slugOnlyArgs struct {
	Slug string `json:"slug"`
}

func (c *customPageCapability) handleBuild(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args slugOnlyArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Slug == "" {
		return capreg.MCPError("slug is required")
	}
	build, err := usecases.Build(ctx, *c.pages, ownerID, args.Slug)
	if err != nil {
		return customPageCapErr(c.log, err, "custom_page.build")
	}
	return marshalCapResult(c.log, "custom_page.build", capBuildView(&build))
}

// ───── custom_page.get_build ───────────────────────────────────

func (c *customPageCapability) getBuildBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "custom_page.get_build",
		Description: "Poll a build for status: pending → building → built|failed.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"build_id":{"type":"string"}
			},
			"required":["build_id"]
		}`),
		Handler: c.handleGetBuild,
	}
}

type buildIDArgs struct {
	BuildID string `json:"build_id"`
}

func (c *customPageCapability) handleGetBuild(
	ctx context.Context, _ string, raw json.RawMessage,
) capreg.MCPResult {
	var args buildIDArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.BuildID == "" {
		return capreg.MCPError("build_id is required")
	}
	build, err := usecases.GetBuild(ctx, *c.pages, args.BuildID)
	if err != nil {
		return customPageCapErr(c.log, err, "custom_page.get_build")
	}
	return marshalCapResult(c.log, "custom_page.get_build", capBuildView(&build))
}

// ───── view helpers + error translation ───────────────────────

type capPageViewT struct {
	ID    string `json:"id"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

type capBuildViewT struct {
	BuildID      string `json:"build_id"`
	PageID       string `json:"page_id"`
	Status       string `json:"status"`
	OutputPath   string `json:"output_path"`
	ErrorMessage string `json:"error_message"`
}

func capPageView(p *domain.CustomPage) capPageViewT {
	return capPageViewT{ID: p.ID, Slug: p.Slug, Title: p.Title}
}

func capBuildView(b *domain.CustomPageBuild) capBuildViewT {
	return capBuildViewT{
		BuildID: b.ID, PageID: b.PageID, Status: b.Status,
		OutputPath: b.OutputPath, ErrorMessage: b.ErrorMessage,
	}
}

func customPageCapErr(log *slog.Logger, err error, name string) capreg.MCPResult {
	switch {
	case errors.Is(err, domain.ErrCustomPageNotFound):
		return capreg.MCPError("page not found")
	case errors.Is(err, domain.ErrCustomPageBuildNotFound):
		return capreg.MCPError("build not found")
	case errors.Is(err, domain.ErrCustomPageSlugTaken):
		return capreg.MCPError("slug already taken")
	}
	log.Error(name, "err", err)
	return capreg.MCPError(name + " failed: " + err.Error())
}
