// cap_corpus_output.go —— Phase E-2: tools_output.go 里 2 个 output 工具迁
// Capability。pattern 同 cap_corpus_raw.go。owner-only。
//
// 2 tools: promote_wiki_to_output / list_recent_output。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capCorpusOutputBundle = "corpus.output.bundle"

type corpusOutputCapability struct {
	corpus *usecases.CorpusDeps
	seo    SEOWriter
	log    *slog.Logger
}

func newCorpusOutputCapability(
	corpus *usecases.CorpusDeps, seo SEOWriter, log *slog.Logger,
) *corpusOutputCapability {
	return &corpusOutputCapability{corpus: corpus, seo: seo, log: log}
}

func (*corpusOutputCapability) ID() string               { return capCorpusOutputBundle }
func (*corpusOutputCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*corpusOutputCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return nil, agentskills.ErrHidden
}

func (*corpusOutputCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (*corpusOutputCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *corpusOutputCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{
		c.promoteWikiToOutputBinding(),
		c.listRecentOutputBinding(),
	}
}

// ───── promote_wiki_to_output ─────────────────────────────────────

func (c *corpusOutputCapability) promoteWikiToOutputBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "promote_wiki_to_output",
		Description: "Promote a wiki entry to a polished output entry " +
			"(refined enough to be quoted verbatim in conversation).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"wiki_id":{"type":"string","description":"wiki_entries.id"},
				"title":{"type":"string","description":"Output title"},
				"path":{"type":"string",
					"description":"Retrieval/landing path. Empty = no path."},
				"parent_id":{"type":"string",
					"description":"Parent output id (root if empty)"},
				"tags":{"type":"array","items":{"type":"string"},
					"description":"Extra tags on top of inherited wiki tags"},
				"show_as_source":{"type":"boolean",
					"description":"false = AI excluded from cited footer (default true)"}
			},
			"required":["wiki_id","title"]
		}`),
		Handler: c.handlePromoteWikiToOutput,
	}
}

type promoteWikiToOutputArgsWire struct {
	ShowAsSource *bool    `json:"show_as_source"`
	WikiID       string   `json:"wiki_id"`
	Title        string   `json:"title"`
	Path         string   `json:"path"`
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
}

func (c *corpusOutputCapability) handlePromoteWikiToOutput(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	args, perr := parsePromoteWikiToOutputArgs(raw)
	if perr != nil {
		return agentskills.MCPError(perr.Error())
	}
	out, err := usecases.PromoteWikiToOutput(ctx, *c.corpus,
		buildPromoteToOutputCapInput(&args, ownerID))
	if err != nil {
		return promoteToOutputErrToResult(c.log, err)
	}
	if perr := c.applyOutputPromotePostProcess(ctx, &out, &args); perr != nil {
		return *perr
	}
	return marshalCapResult(c.log, "promote_wiki_to_output",
		map[string]string{"output_id": out.ID()})
}

func (c *corpusOutputCapability) applyOutputPromotePostProcess(
	ctx context.Context, out *domain.Output, args *promoteWikiToOutputArgsWire,
) *agentskills.MCPResult {
	if args.Path != "" {
		pathPtr := args.Path
		if _, perr := c.seo.UpdateOutputPath(
			ctx, out.ID(), &pathPtr, "", false,
		); perr != nil {
			r := seoErrToResult(c.log, perr, "promote_wiki_to_output set path")
			return &r
		}
	}
	c.applyOutputShowAsSourceIfHidden(ctx, out, args.ShowAsSource)
	return nil
}

func (c *corpusOutputCapability) applyOutputShowAsSourceIfHidden(
	ctx context.Context, out *domain.Output, showAsSource *bool,
) {
	if showAsSource == nil || *showAsSource {
		return
	}
	_, uerr := usecases.UpdateOutput(ctx, *c.corpus, &usecases.UpdateOutputInput{
		OwnerID: out.OwnerID(), ID: out.ID(),
		Title: out.Title(), Body: out.Body(), Tags: out.Tags(),
		ParentID: ptrOrNil(out.ParentID), ShowAsSource: false,
	})
	if uerr != nil {
		c.log.Error("promote_wiki_to_output set show_as_source", "err", uerr)
	}
}

func parsePromoteWikiToOutputArgs(raw json.RawMessage) (promoteWikiToOutputArgsWire, error) {
	var args promoteWikiToOutputArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fmt.Errorf("invalid arguments: %w", err)
	}
	if args.WikiID == "" {
		return args, errors.New("wiki_id is required")
	}
	if args.Title == "" {
		return args, errors.New("title is required")
	}
	return args, nil
}

func buildPromoteToOutputCapInput(
	args *promoteWikiToOutputArgsWire, ownerID string,
) *usecases.PromoteToOutputInput {
	in := &usecases.PromoteToOutputInput{
		OwnerID: ownerID, WikiID: args.WikiID,
		Title: args.Title, Tags: args.Tags,
	}
	if args.ParentID != "" {
		parent := args.ParentID
		in.ParentID = &parent
	}
	return in
}

func promoteToOutputErrToResult(log *slog.Logger, err error) agentskills.MCPResult {
	if errors.Is(err, domain.ErrWikiNotFound) {
		return agentskills.MCPError("wiki entry not found")
	}
	if errors.Is(err, domain.ErrPathTaken) {
		return agentskills.MCPError("path already taken")
	}
	log.Error("cap promote_wiki_to_output", "err", err)
	return agentskills.MCPError("promote_wiki_to_output failed")
}

// ───── list_recent_output ───────────────────────────────────────

func (c *corpusOutputCapability) listRecentOutputBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "list_recent_output",
		Description: "List recent output entries (newest first).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"limit":{"type":"number","description":"Max rows (default 20)"}
			}
		}`),
		Handler: c.handleListRecentOutput,
	}
}

func (c *corpusOutputCapability) handleListRecentOutput(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	limit := parseListLimit(raw)
	rows, err := c.corpus.Output.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		c.log.Error("cap list_recent_output", "err", err)
		return agentskills.MCPError("list failed")
	}
	return marshalCapResult(c.log, "list_recent_output", outputRowsToView(rows))
}

type outputCapView struct {
	CreatedAt     string   `json:"created_at"`
	Path          *string  `json:"path"`
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	Tags          []string `json:"tags"`
	SourceWikiIDs []string `json:"source_wiki_ids"`
}

func outputRowsToView(rows []domain.Output) []outputCapView {
	out := make([]outputCapView, 0, len(rows))
	for i := range rows {
		out = append(out, outputCapView{
			ID: rows[i].ID(), Title: rows[i].Title(), Body: rows[i].Body(),
			Path: ptrOrNil(rows[i].Path), Tags: rows[i].Tags(),
			SourceWikiIDs: rows[i].SourceWikiIDs(),
			CreatedAt:     rows[i].CreatedAt().Format(mcpTimeFmt),
		})
	}
	return out
}
