// cap_corpus_output.go —— Phase E-2: tools_output.go 里 2 个 output 工具迁
// Capability。pattern 同 cap_corpus_raw.go。owner-only。
//
// 2 tools: promote_wiki_to_output / list_recent_output。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capCorpusOutputBundle = "corpus.output.bundle"

type corpusOutputCapability struct {
	corpusDeps *usecases.CorpusDeps
	seo        SEOWriter
	log        *slog.Logger
}

func newCorpusOutputCapability(
	corpusDeps *usecases.CorpusDeps, seo SEOWriter, log *slog.Logger,
) *corpusOutputCapability {
	return &corpusOutputCapability{corpusDeps: corpusDeps, seo: seo, log: log}
}

func (*corpusOutputCapability) ID() string          { return capCorpusOutputBundle }
func (*corpusOutputCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*corpusOutputCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*corpusOutputCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*corpusOutputCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *corpusOutputCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.promoteWikiToOutputBinding(),
		c.listRecentOutputBinding(),
	}
}

// ───── promote_wiki_to_output ─────────────────────────────────────

func (c *corpusOutputCapability) promoteWikiToOutputBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "promote_wiki_to_output",
		Description: "Promote a wiki entry to a polished output entry " +
			"(refined enough to be quoted verbatim in conversation).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"wiki_id":{"type":"string","description":"wiki_entries.id"},
				"title":{"type":"string","description":"Output title"},
				"parent_id":{"type":"string",
					"description":"Parent output id; root if empty. URL is tree-derived."},
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
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
}

func (c *corpusOutputCapability) handlePromoteWikiToOutput(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parsePromoteWikiToOutputArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	out, err := usecases.PromoteWikiToOutput(ctx, *c.corpusDeps,
		buildPromoteToOutputCapInput(&args, ownerID))
	if err != nil {
		return promoteToOutputErrToResult(c.log, err)
	}
	// 地址树派生:promote 不再设 path,只按需藏 show_as_source。
	c.applyOutputShowAsSourceIfHidden(ctx, &out, args.ShowAsSource)
	// 响应带上这条 output 的地址(path),调用方就能直接 corpus_read / 引用它。
	return mcputil.MarshalResult(c.log, "promote_wiki_to_output", map[string]string{
		"output_id": out.ID(),
		"path": entryPathForResponse(
			ctx, c.log, c.corpusDeps, entryRef{"output", ownerID, out.ID()}),
	})
}

func (c *corpusOutputCapability) applyOutputShowAsSourceIfHidden(
	ctx context.Context, out *corpus.Output, showAsSource *bool,
) {
	if showAsSource == nil || *showAsSource {
		return
	}
	_, uerr := usecases.UpdateOutput(ctx, *c.corpusDeps, &usecases.UpdateOutputInput{
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

func promoteToOutputErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, corpus.ErrWikiNotFound) {
		return capreg.MCPError("wiki entry not found")
	}
	log.Error("cap promote_wiki_to_output", "err", err)
	return capreg.MCPError("promote_wiki_to_output failed")
}

// ───── list_recent_output ───────────────────────────────────────

func (c *corpusOutputCapability) listRecentOutputBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
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
) capreg.MCPResult {
	limit := parseListLimit(raw)
	rows, err := c.corpusDeps.Output.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		c.log.Error("cap list_recent_output", "err", err)
		return capreg.MCPError("list failed")
	}
	return mcputil.MarshalResult(c.log, "list_recent_output", outputRowsToView(rows))
}

// path 不回显(同 list_recent_wiki:最近 N 条非全树,算不出准确树派生地址)。
type outputCapView struct {
	CreatedAt     string   `json:"created_at"`
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	Tags          []string `json:"tags"`
	SourceWikiIDs []string `json:"source_wiki_ids"`
}

func outputRowsToView(rows []corpus.Output) []outputCapView {
	out := make([]outputCapView, 0, len(rows))
	for i := range rows {
		out = append(out, outputCapView{
			ID: rows[i].ID(), Title: rows[i].Title(), Body: rows[i].Body(),
			Tags:          rows[i].Tags(),
			SourceWikiIDs: rows[i].SourceWikiIDs(),
			CreatedAt:     rows[i].CreatedAt().Format(mcpTimeFmt),
		})
	}
	return out
}
