// cap_corpus_mutations.go —— Phase E-3 MCP parity: 给 AI 在 Claude Code curate
// corpus 时改 / 删 wiki 和 output 的能力。owner-only。
//
// 4 tools: update_wiki / update_output / delete_wiki / delete_output。

package mcphandle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capCorpusMutationsBundle = "corpus.mutations.bundle"

type corpusMutationsCapability struct {
	corpus *usecases.CorpusDeps
	log    *slog.Logger
}

func newCorpusMutationsCapability(
	corpus *usecases.CorpusDeps, log *slog.Logger,
) *corpusMutationsCapability {
	return &corpusMutationsCapability{corpus: corpus, log: log}
}

func (*corpusMutationsCapability) ID() string          { return capCorpusMutationsBundle }
func (*corpusMutationsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*corpusMutationsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*corpusMutationsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*corpusMutationsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *corpusMutationsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.updateWikiBinding(),
		c.updateOutputBinding(),
		c.deleteWikiBinding(),
		c.deleteOutputBinding(),
	}
}

// ───── update_wiki ────────────────────────────────────────────────

func (c *corpusMutationsCapability) updateWikiBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "update_wiki",
		Description: "Update a wiki entry's title / body / parent / tags / show_as_source.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"wiki_id":{"type":"string","description":"wiki_entries.id"},
				"title":{"type":"string","description":"New title"},
				"body":{"type":"string","description":"New markdown body"},
				"parent_id":{"type":"string",
					"description":"Parent wiki id (empty = root)"},
				"tags":{"type":"array","items":{"type":"string"},
					"description":"Replacement tags"},
				"show_as_source":{"type":"boolean",
					"description":"false = excluded from cited footer (default true)"}
			},
			"required":["wiki_id","title","body"]
		}`),
		Handler: c.handleUpdateWiki,
	}
}

type updateWikiArgsWire struct {
	ShowAsSource *bool    `json:"show_as_source"`
	WikiID       string   `json:"wiki_id"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
}

func (c *corpusMutationsCapability) handleUpdateWiki(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseUpdateWikiArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	in := buildUpdateWikiInput(&args, ownerID)
	wiki, err := usecases.UpdateWiki(ctx, *c.corpus, in)
	if err != nil {
		return wikiMutationErrToResult(c.log, err, "update_wiki")
	}
	return marshalCapResult(c.log, "update_wiki", map[string]any{
		"id": wiki.ID(), "title": wiki.Title(), "body": wiki.Body(),
	})
}

func parseUpdateWikiArgs(raw json.RawMessage) (updateWikiArgsWire, error) {
	var args updateWikiArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fmt.Errorf("invalid arguments: %w", err)
	}
	if args.WikiID == "" {
		return args, errors.New("wiki_id is required")
	}
	if args.Title == "" {
		return args, errors.New("title is required")
	}
	if args.Body == "" {
		return args, errors.New("body is required")
	}
	return args, nil
}

func buildUpdateWikiInput(
	args *updateWikiArgsWire, ownerID string,
) *usecases.UpdateWikiInput {
	in := &usecases.UpdateWikiInput{
		OwnerID: ownerID, ID: args.WikiID,
		Title: args.Title, Body: args.Body, Tags: args.Tags,
		ShowAsSource: args.ShowAsSource == nil || *args.ShowAsSource,
	}
	if args.ParentID != "" {
		parent := args.ParentID
		in.ParentID = &parent
	}
	return in
}

// ───── update_output ───────────────────────────────────────────────

func (c *corpusMutationsCapability) updateOutputBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "update_output",
		Description: "Update an output entry's title / body / parent / tags / show_as_source.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"output_id":{"type":"string","description":"output_entries.id"},
				"title":{"type":"string","description":"New title"},
				"body":{"type":"string","description":"New markdown body"},
				"parent_id":{"type":"string",
					"description":"Parent output id (empty = root)"},
				"tags":{"type":"array","items":{"type":"string"},
					"description":"Replacement tags"},
				"show_as_source":{"type":"boolean",
					"description":"false = excluded from cited footer (default true)"}
			},
			"required":["output_id","title","body"]
		}`),
		Handler: c.handleUpdateOutput,
	}
}

type updateOutputArgsWire struct {
	ShowAsSource *bool    `json:"show_as_source"`
	OutputID     string   `json:"output_id"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
}

func (c *corpusMutationsCapability) handleUpdateOutput(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseUpdateOutputArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	in := buildUpdateOutputInput(&args, ownerID)
	out, err := usecases.UpdateOutput(ctx, *c.corpus, in)
	if err != nil {
		return outputMutationErrToResult(c.log, err, "update_output")
	}
	return marshalCapResult(c.log, "update_output", map[string]any{
		"id": out.ID(), "title": out.Title(), "body": out.Body(),
	})
}

func parseUpdateOutputArgs(raw json.RawMessage) (updateOutputArgsWire, error) {
	var args updateOutputArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fmt.Errorf("invalid arguments: %w", err)
	}
	if args.OutputID == "" {
		return args, errors.New("output_id is required")
	}
	if args.Title == "" {
		return args, errors.New("title is required")
	}
	if args.Body == "" {
		return args, errors.New("body is required")
	}
	return args, nil
}

func buildUpdateOutputInput(
	args *updateOutputArgsWire, ownerID string,
) *usecases.UpdateOutputInput {
	in := &usecases.UpdateOutputInput{
		OwnerID: ownerID, ID: args.OutputID,
		Title: args.Title, Body: args.Body, Tags: args.Tags,
		ShowAsSource: args.ShowAsSource == nil || *args.ShowAsSource,
	}
	if args.ParentID != "" {
		parent := args.ParentID
		in.ParentID = &parent
	}
	return in
}

// ───── delete_wiki ────────────────────────────────────────────────

func (c *corpusMutationsCapability) deleteWikiBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "delete_wiki",
		Description: "Hard-delete a wiki entry by id.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"wiki_id":{"type":"string","description":"wiki_entries.id"}
			},
			"required":["wiki_id"]
		}`),
		Handler: c.handleDeleteWiki,
	}
}

type deleteByIDArgsWire struct {
	WikiID   string `json:"wiki_id"`
	OutputID string `json:"output_id"`
}

func (c *corpusMutationsCapability) handleDeleteWiki(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args deleteByIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.WikiID == "" {
		return capreg.MCPError("wiki_id is required")
	}
	if err := usecases.DeleteWiki(ctx, *c.corpus, ownerID, args.WikiID); err != nil {
		return wikiMutationErrToResult(c.log, err, "delete_wiki")
	}
	return marshalCapResult(c.log, "delete_wiki", map[string]any{
		"id": args.WikiID, "deleted": true,
	})
}

// ───── delete_output ───────────────────────────────────────────────

func (c *corpusMutationsCapability) deleteOutputBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "delete_output",
		Description: "Hard-delete an output entry by id.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"output_id":{"type":"string","description":"output_entries.id"}
			},
			"required":["output_id"]
		}`),
		Handler: c.handleDeleteOutput,
	}
}

func (c *corpusMutationsCapability) handleDeleteOutput(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args deleteByIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.OutputID == "" {
		return capreg.MCPError("output_id is required")
	}
	if err := usecases.DeleteOutput(ctx, *c.corpus, ownerID, args.OutputID); err != nil {
		return outputMutationErrToResult(c.log, err, "delete_output")
	}
	return marshalCapResult(c.log, "delete_output", map[string]any{
		"id": args.OutputID, "deleted": true,
	})
}

// ───── error helpers ───────────────────────────────────────────────

func wikiMutationErrToResult(
	log *slog.Logger, err error, name string,
) capreg.MCPResult {
	if errors.Is(err, domain.ErrWikiNotFound) {
		return capreg.MCPError("wiki entry not found")
	}
	if errors.Is(err, domain.ErrParentNotFound) {
		return capreg.MCPError("parent entry not found")
	}
	if errors.Is(err, domain.ErrParentCycle) {
		return capreg.MCPError("parent would create a cycle")
	}
	if errors.Is(err, usecases.ErrEmptyField) {
		return capreg.MCPError("required field missing")
	}
	log.Error("cap "+name, "err", err)
	return capreg.MCPError(name + " failed")
}

func outputMutationErrToResult(
	log *slog.Logger, err error, name string,
) capreg.MCPResult {
	if errors.Is(err, domain.ErrOutputNotFound) {
		return capreg.MCPError("output entry not found")
	}
	if errors.Is(err, usecases.ErrEmptyField) {
		return capreg.MCPError("required field missing")
	}
	log.Error("cap "+name, "err", err)
	return capreg.MCPError(name + " failed")
}
