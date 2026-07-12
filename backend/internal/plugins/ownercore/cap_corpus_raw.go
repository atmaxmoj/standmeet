// cap_corpus_raw.go —— Phase E-1: tools.go 里 4 个 corpus 工具迁 Capability。
// 老 srv.AddTool 路径删；走 capreg.Registry → adapter.go
// wrapCapabilityHandler 统一入口。owner-only。
//
// 4 tools: raw_dump / promote_to_wiki / list_recent_raw / list_recent_wiki。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capCorpusRawBundle = "corpus.raw.bundle"

type corpusRawCapability struct {
	corpus *usecases.CorpusDeps
	seo    SEOWriter
	log    *slog.Logger
}

func newCorpusRawCapability(
	corpus *usecases.CorpusDeps, seo SEOWriter, log *slog.Logger,
) *corpusRawCapability {
	return &corpusRawCapability{corpus: corpus, seo: seo, log: log}
}

func (*corpusRawCapability) ID() string          { return capCorpusRawBundle }
func (*corpusRawCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*corpusRawCapability) VisitorBinding(_ context.Context, _ *capreg.AssembleInput) (
	*capreg.Binding, error,
) {
	return nil, capreg.ErrHidden
}

func (*corpusRawCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*corpusRawCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *corpusRawCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.rawDumpBinding(),
		c.promoteToWikiBinding(),
		c.listRecentRawBinding(),
		c.listRecentWikiBinding(),
	}
}

// ───── raw_dump ───────────────────────────────────────────────────

func (c *corpusRawCapability) rawDumpBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "raw_dump",
		Description: "Push a raw insight (rough draft) into the owner's corpus.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"body":{"type":"string",
					"description":"Markdown body of the raw insight."},
				"source":{"type":"string",
					"description":"Source label (e.g. mcp:claude-desktop). Default 'mcp'."},
				"tags":{"type":"array","items":{"type":"string"},
					"description":"Optional tags."},
				"flagged_private":{"type":"boolean",
					"description":"Mark this raw as private hint (default false)."}
			},
			"required":["body"]
		}`),
		Handler: c.handleRawDump,
	}
}

type rawDumpArgsWire struct {
	Body           string   `json:"body"`
	Source         string   `json:"source"`
	Tags           []string `json:"tags"`
	FlaggedPrivate bool     `json:"flagged_private"`
}

func (c *corpusRawCapability) handleRawDump(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args rawDumpArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Body == "" {
		return capreg.MCPError("body is required")
	}
	source := args.Source
	if source == "" {
		source = "mcp"
	}
	rawEntry, err := usecases.RawDump(ctx, *c.corpus, &usecases.RawDumpInput{
		OwnerID: ownerID, Body: args.Body, Source: source,
		Tags: args.Tags, FlaggedPrivate: args.FlaggedPrivate,
	})
	if err != nil {
		c.log.Error("cap raw_dump", "err", err)
		return capreg.MCPError("raw_dump failed")
	}
	return mcputil.MarshalResult(c.log, "raw_dump",
		map[string]string{"raw_id": rawEntry.ID()})
}

// ───── promote_to_wiki ───────────────────────────────────────────

func (c *corpusRawCapability) promoteToWikiBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "promote_to_wiki",
		Description: "Promote a raw entry to a curated wiki entry.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"raw_id":{"type":"string","description":"raw_entries.id"},
				"title":{"type":"string","description":"Wiki title"},
				"parent_id":{"type":"string",
					"description":"Parent wiki id; root if empty. URL is tree-derived."},
				"tags":{"type":"array","items":{"type":"string"},
					"description":"Extra tags on top of inherited raw tags"},
				"show_as_source":{"type":"boolean",
					"description":"false = AI excluded from cited footer (default true)"}
			},
			"required":["raw_id","title"]
		}`),
		Handler: c.handlePromoteToWiki,
	}
}

type promoteToWikiArgsWire struct {
	ShowAsSource *bool    `json:"show_as_source"`
	RawID        string   `json:"raw_id"`
	Title        string   `json:"title"`
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
}

func (c *corpusRawCapability) handlePromoteToWiki(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parsePromoteToWikiArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	wikiEntry, err := usecases.PromoteToWiki(ctx, *c.corpus,
		buildPromoteToWikiInput(&args, ownerID))
	if err != nil {
		return promoteErrToResult(c.log, err)
	}
	// 地址树派生:promote 不再设 path,只按需藏 show_as_source。
	c.applyShowAsSourceIfHidden(ctx, &wikiEntry, args.ShowAsSource)
	// 响应带上这条 wiki 的地址(path),调用方就能直接 corpus_read / 引用它。
	return mcputil.MarshalResult(c.log, "promote_to_wiki", map[string]string{
		"wiki_id": wikiEntry.ID(),
		"path": entryPathForResponse(
			ctx, c.log, c.corpus, entryRef{"wiki", ownerID, wikiEntry.ID()}),
	})
}

func (c *corpusRawCapability) applyShowAsSourceIfHidden(
	ctx context.Context, wikiEntry *domain.Wiki, showAsSource *bool,
) {
	if showAsSource == nil || *showAsSource {
		return
	}
	_, uerr := usecases.UpdateWiki(ctx, *c.corpus, &usecases.UpdateWikiInput{
		OwnerID: wikiEntry.OwnerID(), ID: wikiEntry.ID(),
		Title: wikiEntry.Title(), Body: wikiEntry.Body(), Tags: wikiEntry.Tags(),
		ParentID: ptrOrNil(wikiEntry.ParentID), ShowAsSource: false,
	})
	if uerr != nil {
		c.log.Error("promote_to_wiki set show_as_source", "err", uerr)
	}
}

func parsePromoteToWikiArgs(raw json.RawMessage) (promoteToWikiArgsWire, error) {
	var args promoteToWikiArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fmt.Errorf("invalid arguments: %w", err)
	}
	if args.RawID == "" {
		return args, errors.New("raw_id is required")
	}
	if args.Title == "" {
		return args, errors.New("title is required")
	}
	return args, nil
}

func buildPromoteToWikiInput(args *promoteToWikiArgsWire, ownerID string) *usecases.PromoteInput {
	in := &usecases.PromoteInput{
		OwnerID: ownerID, RawID: args.RawID,
		Title: args.Title, Tags: args.Tags,
	}
	if args.ParentID != "" {
		parent := args.ParentID
		in.ParentID = &parent
	}
	return in
}

func promoteErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, domain.ErrRawNotFound) {
		return capreg.MCPError("raw entry not found")
	}
	if errors.Is(err, domain.ErrParentNotFound) {
		return capreg.MCPError("parent entry not found")
	}
	if errors.Is(err, domain.ErrSiblingSlugTaken) {
		return capreg.MCPError("an entry with the same name already exists here")
	}
	log.Error("cap promote_to_wiki", "err", err)
	return capreg.MCPError("promote_to_wiki failed")
}

// ───── list_recent_raw ───────────────────────────────────────────

func (c *corpusRawCapability) listRecentRawBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "list_recent_raw",
		Description: "List recent raw entries (newest first).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"limit":{"type":"number","description":"Max rows (default 20)"}
			}
		}`),
		Handler: c.handleListRecentRaw,
	}
}

func (c *corpusRawCapability) handleListRecentRaw(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	limit := parseListLimit(raw)
	rows, err := c.corpus.Raw.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		c.log.Error("cap list_recent_raw", "err", err)
		return capreg.MCPError("list failed")
	}
	return mcputil.MarshalResult(c.log, "list_recent_raw", rawRowsToView(rows))
}

// ───── list_recent_wiki ───────────────────────────────────────────

func (c *corpusRawCapability) listRecentWikiBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "list_recent_wiki",
		Description: "List recent wiki entries (newest first).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"limit":{"type":"number","description":"Max rows (default 20)"}
			}
		}`),
		Handler: c.handleListRecentWiki,
	}
}

func (c *corpusRawCapability) handleListRecentWiki(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	limit := parseListLimit(raw)
	rows, err := c.corpus.Wiki.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		c.log.Error("cap list_recent_wiki", "err", err)
		return capreg.MCPError("list failed")
	}
	return mcputil.MarshalResult(c.log, "list_recent_wiki", wikiRowsToView(rows))
}

// view helpers + parseListLimit 移到 cap_helpers.go (marshalCapResult 已提升为 capreg.MarshalResult)
