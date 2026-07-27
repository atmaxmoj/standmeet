// cap_subjectivity.go —— subjectivity genre 的 owner-only capability。1 tool: subjectivity_write
// （建/改一条 owner 自我模型笔记）。pattern 同 cap_corpus_output.go。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

const capSubjectivityBundle = "corpus.subjectivity.bundle"

type subjectivityCapability struct {
	corpusDeps *corpus.Deps
	log        *slog.Logger
}

func newSubjectivityCapability(
	corpusDeps *corpus.Deps, log *slog.Logger,
) *subjectivityCapability {
	return &subjectivityCapability{corpusDeps: corpusDeps, log: log}
}

func (*subjectivityCapability) ID() string          { return capSubjectivityBundle }
func (*subjectivityCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*subjectivityCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*subjectivityCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*subjectivityCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *subjectivityCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.subjectivityWriteBinding()}
}

func (c *subjectivityCapability) subjectivityWriteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "subjectivity_write",
		Description: "Write (create or update) a subjectivity note — the owner's self-model " +
			"(taste, judgment, what they care about). Prose notes; address is tree-derived.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"title":{"type":"string","description":"Note title (its path segment)"},
				"body":{"type":"string","description":"Prose body"},
				"subjectivity_id":{"type":"string",
					"description":"Existing note id to update/reparent; empty = create new"},
				"parent_id":{"type":"string",
					"description":"Parent subjectivity id; root if empty. Path is tree-derived."},
				"tags":{"type":"array","items":{"type":"string"}},
				"show_as_source":{"type":"boolean",
					"description":"Cite this note to visitors. Default false (private)."}
			},
			"required":["title","body"]
		}`),
		Handler: c.handleSubjectivityWrite,
	}
}

type subjectivityWriteArgsWire struct {
	// ShowAsSource *bool：省略 = nil → 默认 false（subjectivity 私有）。与 wiki/output 的
	// 默认 true 相反,故不能用 bool 零值当"未给"。
	ShowAsSource *bool    `json:"show_as_source"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	ID           string   `json:"subjectivity_id"`
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
	CSSClasses   []string `json:"css_classes"`
}

func (c *subjectivityCapability) handleSubjectivityWrite(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseSubjectivityWriteArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	res, err := corpus.WriteSubjectivity(
		ctx, *c.corpusDeps, buildWriteSubjectivityInput(&args, ownerID),
	)
	if err != nil {
		return subjectivityWriteErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "subjectivity_write",
		map[string]string{"subjectivity_id": res.ID, "path": res.Path})
}

func parseSubjectivityWriteArgs(raw json.RawMessage) (subjectivityWriteArgsWire, error) {
	var args subjectivityWriteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fmt.Errorf("invalid arguments: %w", err)
	}
	if args.Title == "" {
		return args, errors.New("title is required")
	}
	if args.Body == "" {
		return args, errors.New("body is required")
	}
	return args, nil
}

func buildWriteSubjectivityInput(
	args *subjectivityWriteArgsWire, ownerID string,
) *corpus.WriteSubjectivityInput {
	in := &corpus.WriteSubjectivityInput{
		OwnerID: ownerID, ID: args.ID,
		Title: args.Title, Body: args.Body, Tags: args.Tags, CSSClasses: args.CSSClasses,
		// 省略(nil) → false：subjectivity 默认私有,不进 visitor cited footer。
		ShowAsSource: args.ShowAsSource != nil && *args.ShowAsSource,
	}
	if args.ParentID != "" {
		parent := args.ParentID
		in.ParentID = &parent
	}
	return in
}

func subjectivityWriteErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	switch {
	case errors.Is(err, corpus.ErrParentNotFound):
		return capreg.MCPError("parent entry not found")
	case errors.Is(err, corpus.ErrParentCycle):
		return capreg.MCPError("cannot reparent: would create a cycle")
	case errors.Is(err, apierr.ErrEmptyField):
		return capreg.MCPError("title and body are required")
	default:
		log.Error("cap subjectivity_write", "err", err)
		return capreg.MCPError("subjectivity_write failed")
	}
}
