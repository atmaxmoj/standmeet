// cap_corpus_raw.go —— Phase E-1: tools.go 里 4 个 corpus 工具迁 Capability。
// 老 srv.AddTool 路径删；走 agentskills.Registry → adapter.go
// wrapCapabilityHandler 统一入口。owner-only。
//
// 4 tools: raw_dump / promote_to_wiki / list_recent_raw / list_recent_wiki。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
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

func (*corpusRawCapability) ID() string               { return capCorpusRawBundle }
func (*corpusRawCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*corpusRawCapability) VisitorBinding(_ context.Context, _ *agentskills.AssembleInput) (
	*agentskills.Binding, error,
) {
	return nil, agentskills.ErrHidden
}

func (*corpusRawCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (*corpusRawCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *corpusRawCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{
		c.rawDumpBinding(),
		c.promoteToWikiBinding(),
		c.listRecentRawBinding(),
		c.listRecentWikiBinding(),
	}
}

// ───── raw_dump ───────────────────────────────────────────────────

func (c *corpusRawCapability) rawDumpBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	var args rawDumpArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.Body == "" {
		return agentskills.MCPError("body is required")
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
		return agentskills.MCPError("raw_dump failed")
	}
	return marshalCapResult(c.log, "raw_dump",
		map[string]string{"raw_id": rawEntry.ID()})
}

// ───── promote_to_wiki ───────────────────────────────────────────

func (c *corpusRawCapability) promoteToWikiBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "promote_to_wiki",
		Description: "Promote a raw entry to a curated wiki entry.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"raw_id":{"type":"string","description":"raw_entries.id"},
				"title":{"type":"string","description":"Wiki title"},
				"path":{"type":"string",
					"description":"Retrieval/landing path. Empty = no path."},
				"parent_id":{"type":"string",
					"description":"Parent wiki id (root if empty)"},
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
	Path         string   `json:"path"`
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
}

func (c *corpusRawCapability) handlePromoteToWiki(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	args, perr := parsePromoteToWikiArgs(raw)
	if perr != nil {
		return agentskills.MCPError(perr.Error())
	}
	wikiEntry, err := usecases.PromoteToWiki(ctx, *c.corpus,
		buildPromoteToWikiInput(&args, ownerID))
	if err != nil {
		return promoteErrToResult(c.log, err)
	}
	if perr := c.applyPromotePostProcess(ctx, &wikiEntry, &args); perr != nil {
		return *perr
	}
	return marshalCapResult(c.log, "promote_to_wiki",
		map[string]string{"wiki_id": wikiEntry.ID()})
}

func (c *corpusRawCapability) applyPromotePostProcess(
	ctx context.Context, wikiEntry *domain.Wiki, args *promoteToWikiArgsWire,
) *agentskills.MCPResult {
	if args.Path != "" {
		pathPtr := args.Path
		if _, perr := c.seo.UpdateWikiPath(
			ctx, wikiEntry.ID(), &pathPtr, "", false,
		); perr != nil {
			r := seoErrToResult(c.log, perr, "promote_to_wiki set path")
			return &r
		}
	}
	c.applyShowAsSourceIfHidden(ctx, wikiEntry, args.ShowAsSource)
	return nil
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

func promoteErrToResult(log *slog.Logger, err error) agentskills.MCPResult {
	if errors.Is(err, domain.ErrRawNotFound) {
		return agentskills.MCPError("raw entry not found")
	}
	if errors.Is(err, domain.ErrPathTaken) {
		return agentskills.MCPError("path already taken")
	}
	log.Error("cap promote_to_wiki", "err", err)
	return agentskills.MCPError("promote_to_wiki failed")
}

// ───── list_recent_raw ───────────────────────────────────────────

func (c *corpusRawCapability) listRecentRawBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	limit := parseListLimit(raw)
	rows, err := c.corpus.Raw.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		c.log.Error("cap list_recent_raw", "err", err)
		return agentskills.MCPError("list failed")
	}
	return marshalCapResult(c.log, "list_recent_raw", rawRowsToView(rows))
}

// ───── list_recent_wiki ───────────────────────────────────────────

func (c *corpusRawCapability) listRecentWikiBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	limit := parseListLimit(raw)
	rows, err := c.corpus.Wiki.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		c.log.Error("cap list_recent_wiki", "err", err)
		return agentskills.MCPError("list failed")
	}
	return marshalCapResult(c.log, "list_recent_wiki", wikiRowsToView(rows))
}

// view helpers + marshalCapResult + parseListLimit 移到 cap_helpers.go
