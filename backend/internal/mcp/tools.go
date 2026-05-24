// tools.go —— MCP 工具实现。
//
// MCP 协议把"工具执行错误"通过 *CallToolResult.IsError=true 传回客户端，
// 而 Go handler 签名虽是 (result, error) 但 error 只在 transport 故障时返。
// 所以 handler 内部 invoke helper 全部返 *CallToolResult（错误 = NewToolResultError）；
// handler 自己一行调 helper 然后 `return result, nil`，避免被 nilerr linter
// 抓"if err != nil { return X, nil }" 模式。

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

const (
	defaultListLimit = 20
	mcpTimeFmt       = "2006-01-02T15:04:05Z"
)

func corpusTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(rawDumpTool(), wrapTool(invokeRawDump(deps)))
	srv.AddTool(promoteToWikiTool(), wrapTool(invokePromoteToWiki(deps)))
	srv.AddTool(listRawTool(), wrapTool(invokeListRaw(deps)))
	srv.AddTool(listWikiTool(), wrapTool(invokeListWiki(deps)))
}

// invokeFn —— 一个工具的"真"实现：输入 ctx + req，输出 result（错误也走 result）。
type invokeFn func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult

// wrapTool 把 invokeFn 适配成 mcp-go 的 ToolHandlerFunc 签名。
// handler 只一行 `return invoke(...), nil`，error 永远 nil（transport 没炸）。
func wrapTool(fn invokeFn) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		return fn(ctx, &req), nil
	}
}

// ---- raw_dump ---------------------------------------------------------

func rawDumpTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"raw_dump",
		mcpgo.WithDescription("Push a raw insight (rough draft) into the owner's corpus."),
		mcpgo.WithString("body", mcpgo.Required(),
			mcpgo.Description("Markdown body of the raw insight.")),
		mcpgo.WithString("source",
			mcpgo.Description("Source label, e.g. 'mcp:claude-desktop'. Default 'mcp'.")),
		mcpgo.WithArray("tags",
			mcpgo.Description("Optional tags (string array).")),
		mcpgo.WithBoolean("flagged_private",
			mcpgo.Description("Mark this raw as private hint (default false).")),
	)
}

func invokeRawDump(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		body, rerr := req.RequireString("body")
		if rerr != nil {
			return mcpgo.NewToolResultError("body is required")
		}
		in := &usecases.RawDumpInput{
			OwnerID:        ownerID,
			Body:           body,
			Source:         req.GetString("source", "mcp"),
			Tags:           req.GetStringSlice("tags", nil),
			FlaggedPrivate: req.GetBool("flagged_private", false),
		}
		raw, err := usecases.RawDump(ctx, deps.Corpus, in)
		if err != nil {
			deps.Log.Error("mcp raw_dump", "err", err)
			return mcpgo.NewToolResultError("raw_dump failed")
		}
		return marshalResult(deps, rawIDPayload{RawID: raw.ID})
	}
}

// ---- promote_to_wiki --------------------------------------------------

func promoteToWikiTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"promote_to_wiki",
		mcpgo.WithDescription("Promote a raw entry to a curated wiki entry."),
		mcpgo.WithString("raw_id", mcpgo.Required(), mcpgo.Description("raw_entries.id")),
		mcpgo.WithString("title", mcpgo.Required(), mcpgo.Description("Wiki title")),
		mcpgo.WithString("path",
			mcpgo.Description("Retrieval/landing path (e.g. projects/lucerna). Empty = no path.")),
		mcpgo.WithString("parent_id", mcpgo.Description("Parent wiki id (root if empty)")),
		mcpgo.WithArray("tags", mcpgo.Description("Extra tags on top of inherited raw tags")),
		mcpgo.WithBoolean("show_as_source",
			mcpgo.Description("false = AI can read but excluded from cited footer (default true)")),
	)
}

func invokePromoteToWiki(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		in, perr := parsePromoteParams(req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		return runPromote(ctx, deps, in, readPromoteOpts(req))
	}
}

func parsePromoteParams(
	req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.PromoteInput, error) {
	rawID, err := req.RequireString("raw_id")
	if err != nil {
		return nil, errors.New("raw_id is required")
	}
	title, err := req.RequireString("title")
	if err != nil {
		return nil, errors.New("title is required")
	}
	return buildPromoteInput(req, ownerID, rawID, title), nil
}

func buildPromoteInput(
	req *mcpgo.CallToolRequest, ownerID, rawID, title string,
) *usecases.PromoteInput {
	in := &usecases.PromoteInput{
		OwnerID: ownerID,
		RawID:   rawID,
		Title:   title,
		Tags:    req.GetStringSlice("tags", nil),
	}
	if parent := req.GetString("parent_id", ""); parent != "" {
		in.ParentID = &parent
	}
	return in
}

// ---- list_recent_raw / list_recent_wiki -------------------------------

func listRawTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"list_recent_raw",
		mcpgo.WithDescription("List recent raw entries (newest first)."),
		mcpgo.WithNumber("limit", mcpgo.Description("Max rows (default 20)")),
	)
}

func invokeListRaw(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		limit := int32(req.GetFloat("limit", float64(defaultListLimit)))
		rows, err := deps.Corpus.Raw.ListByOwner(ctx, ownerID, limit)
		if err != nil {
			deps.Log.Error("mcp list_recent_raw", "err", err)
			return mcpgo.NewToolResultError("list failed")
		}
		return marshalResult(deps, rawListView(rows))
	}
}

func listWikiTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"list_recent_wiki",
		mcpgo.WithDescription("List recent wiki entries (newest first)."),
		mcpgo.WithNumber("limit", mcpgo.Description("Max rows (default 20)")),
	)
}

func invokeListWiki(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		limit := int32(req.GetFloat("limit", float64(defaultListLimit)))
		rows, err := deps.Corpus.Wiki.ListByOwner(ctx, ownerID, limit)
		if err != nil {
			deps.Log.Error("mcp list_recent_wiki", "err", err)
			return mcpgo.NewToolResultError("list failed")
		}
		return marshalResult(deps, wikiListView(rows))
	}
}

// ---- payload types ----------------------------------------------------

type rawIDPayload struct {
	RawID string `json:"raw_id"`
}

func (p rawIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal raw id payload: %w", err)
	}
	return b, nil
}

type wikiIDPayload struct {
	WikiID string `json:"wiki_id"`
}

func (p wikiIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal wiki id payload: %w", err)
	}
	return b, nil
}

type rawView struct {
	CreatedAt string   `json:"created_at"`
	ID        string   `json:"id"`
	Body      string   `json:"body"`
	Source    string   `json:"source"`
	Tags      []string `json:"tags"`
	Archived  bool     `json:"archived"`
}

func rawListView(rows []domain.RawEntry) rawListPayload {
	out := make(rawListPayload, 0, len(rows))
	for i := range rows {
		out = append(out, rawView{
			ID:        rows[i].ID,
			Body:      rows[i].Body,
			Source:    rows[i].Source,
			Tags:      rows[i].Tags,
			CreatedAt: rows[i].CreatedAt.Format(mcpTimeFmt),
			Archived:  rows[i].Archived,
		})
	}
	return out
}

type rawListPayload []rawView

func (p rawListPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal raw list payload: %w", err)
	}
	return b, nil
}

type wikiView struct {
	CreatedAt string   `json:"created_at"`
	ParentID  *string  `json:"parent_id"`
	Path      *string  `json:"path"`
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
}

func wikiListView(rows []domain.WikiEntry) wikiListPayload {
	out := make(wikiListPayload, 0, len(rows))
	for i := range rows {
		out = append(out, wikiView{
			ID:        rows[i].ID,
			Title:     rows[i].Title,
			Tags:      rows[i].Tags,
			ParentID:  rows[i].ParentID,
			Path:      rows[i].Path,
			CreatedAt: rows[i].CreatedAt.Format(mcpTimeFmt),
		})
	}
	return out
}

type wikiListPayload []wikiView

func (p wikiListPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal wiki list payload: %w", err)
	}
	return b, nil
}

// payload 接口规定每种 mcp tool 返回的 JSON payload 都有自己的 marshalJSON。
// 用 interface 把 marshal entry point 收敛在一处，避免 `any` 出现。
type payload interface {
	marshalJSON() ([]byte, error)
}

// marshalResult 序列化 payload 成 *CallToolResult；marshal 失败时返 error result。
func marshalResult(deps *Deps, p payload) *mcpgo.CallToolResult {
	b, err := p.marshalJSON()
	if err != nil {
		deps.Log.Error("mcp marshal payload", "err", err)
		return mcpgo.NewToolResultError(fmt.Sprintf("encode payload: %v", err))
	}
	return mcpgo.NewToolResultText(string(b))
}
