// tools_output.go —— output 层 MCP 工具：promote_wiki_to_output +
// list_recent_output。raw / wiki / output 三层 promote 链：
//   raw_dump → promote_to_wiki → promote_wiki_to_output

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

func outputTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(promoteWikiToOutputTool(), wrapTool(invokePromoteWikiToOutput(deps)))
	srv.AddTool(listOutputTool(), wrapTool(invokeListOutput(deps)))
}

// ---- promote_wiki_to_output -------------------------------------------

func promoteWikiToOutputTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"promote_wiki_to_output",
		mcpgo.WithDescription(
			"Promote a wiki entry to a polished output entry "+
				"(refined enough to be quoted verbatim in conversation).",
		),
		mcpgo.WithString("wiki_id", mcpgo.Required(), mcpgo.Description("wiki_entries.id")),
		mcpgo.WithString("title", mcpgo.Required(), mcpgo.Description("Output title")),
		mcpgo.WithString("path",
			mcpgo.Description("Retrieval/landing path (e.g. projects/lucerna). Empty = no path.")),
		mcpgo.WithString("parent_id", mcpgo.Description("Parent output id (root if empty)")),
		mcpgo.WithArray("tags", mcpgo.Description("Extra tags on top of inherited wiki tags")),
		mcpgo.WithBoolean("show_as_source",
			mcpgo.Description("false = AI can read but excluded from cited footer (default true)")),
	)
}

func invokePromoteWikiToOutput(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		in, perr := parsePromoteToOutputParams(req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		return runPromoteToOutput(ctx, deps, in, readPromoteOpts(req))
	}
}

func parsePromoteToOutputParams(
	req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.PromoteToOutputInput, error) {
	wikiID, err := req.RequireString("wiki_id")
	if err != nil {
		return nil, errors.New("wiki_id is required")
	}
	title, err := req.RequireString("title")
	if err != nil {
		return nil, errors.New("title is required")
	}
	return buildPromoteToOutputInput(req, ownerID, wikiID, title), nil
}

func buildPromoteToOutputInput(
	req *mcpgo.CallToolRequest, ownerID, wikiID, title string,
) *usecases.PromoteToOutputInput {
	in := &usecases.PromoteToOutputInput{
		OwnerID: ownerID,
		WikiID:  wikiID,
		Title:   title,
		Tags:    req.GetStringSlice("tags", nil),
	}
	if parent := req.GetString("parent_id", ""); parent != "" {
		in.ParentID = &parent
	}
	return in
}

func runPromoteToOutput(
	ctx context.Context, deps *Deps, in *usecases.PromoteToOutputInput, opts promoteOpts,
) *mcpgo.CallToolResult {
	out, err := usecases.PromoteWikiToOutput(ctx, deps.Corpus, in)
	if err != nil {
		if errors.Is(err, domain.ErrWikiNotFound) {
			return mcpgo.NewToolResultError("wiki entry not found")
		}
		deps.Log.Error("mcp promote_wiki_to_output", "err", err)
		return mcpgo.NewToolResultError("promote_wiki_to_output failed")
	}
	if presult := applyOutputPromotePostProcess(ctx, deps, &out, opts); presult != nil {
		return presult
	}
	return marshalResult(deps, outputIDPayload{OutputID: out.ID()})
}

func applyOutputPromotePostProcess(
	ctx context.Context, deps *Deps, out *domain.Output, opts promoteOpts,
) *mcpgo.CallToolResult {
	if r := setOutputPathOpt(ctx, deps, out.ID(), opts.path); r != nil {
		return r
	}
	if opts.hideAsSource {
		hideOutputAsSource(ctx, deps, out)
	}
	return nil
}

func setOutputPathOpt(
	ctx context.Context, deps *Deps, outputID string, path *string,
) *mcpgo.CallToolResult {
	if path == nil || *path == "" {
		return nil
	}
	if _, perr := deps.SEO.UpdateOutputPath(ctx, outputID, path, "", false); perr != nil {
		return seoErrorResult(deps, perr, "promote_wiki_to_output set path")
	}
	return nil
}

func hideOutputAsSource(ctx context.Context, deps *Deps, out *domain.Output) {
	_, uerr := usecases.UpdateOutput(ctx, deps.Corpus, &usecases.UpdateOutputInput{
		OwnerID: out.OwnerID(), ID: out.ID(),
		Title: out.Title(), Body: out.Body(), Tags: out.Tags(),
		ParentID: ptrOrNil(out.ParentID), ShowAsSource: false,
	})
	if uerr != nil {
		deps.Log.Error("promote_wiki_to_output set show_as_source", "err", uerr)
	}
}

// ---- list_recent_output -----------------------------------------------

func listOutputTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"list_recent_output",
		mcpgo.WithDescription("List recent output entries (newest first)."),
		mcpgo.WithNumber("limit", mcpgo.Description("Max rows (default 20)")),
	)
}

func invokeListOutput(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		limit := int32(req.GetFloat("limit", float64(defaultListLimit)))
		rows, err := deps.Corpus.Output.ListByOwner(ctx, ownerID, limit)
		if err != nil {
			deps.Log.Error("mcp list_recent_output", "err", err)
			return mcpgo.NewToolResultError("list failed")
		}
		return marshalResult(deps, outputListView(rows))
	}
}

// ---- payload types ----------------------------------------------------

type outputIDPayload struct {
	OutputID string `json:"output_id"`
}

func (p outputIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal output id payload: %w", err)
	}
	return b, nil
}

type outputView struct {
	CreatedAt     string   `json:"created_at"`
	Path          *string  `json:"path"`
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	Tags          []string `json:"tags"`
	SourceWikiIDs []string `json:"source_wiki_ids"`
}

func outputListView(rows []domain.Output) outputListPayload {
	out := make(outputListPayload, 0, len(rows))
	for i := range rows {
		out = append(out, outputView{
			ID:            rows[i].ID(),
			Title:         rows[i].Title(),
			Body:          rows[i].Body(),
			Path:          ptrOrNil(rows[i].Path),
			Tags:          rows[i].Tags(),
			SourceWikiIDs: rows[i].SourceWikiIDs(),
			CreatedAt:     rows[i].CreatedAt().Format(mcpTimeFmt),
		})
	}
	return out
}

type outputListPayload []outputView

func (p outputListPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal output list: %w", err)
	}
	return b, nil
}
