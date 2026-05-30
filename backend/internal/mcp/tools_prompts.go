// tools_prompts.go —— prompt_create / prompt_list / prompt_delete MCP tools。
// owner 通过 Claude Desktop CRUD persona library；vanilla 不可删 / 不可改名
// （usecase 层拦）。

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

func promptsTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(promptCreateTool(), wrapTool(invokePromptCreate(deps)))
	srv.AddTool(promptListTool(), wrapTool(invokePromptList(deps)))
	srv.AddTool(promptDeleteTool(), wrapTool(invokePromptDelete(deps)))
}

func promptCreateTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"prompt_create",
		mcpgo.WithDescription("Create an owner-curated Prompt (persona / instruction "+
			"fragment library). Roles reference prompts; visitor sessions snapshot the "+
			"prompt body into RoleSnapshot.PromptBody at session start."),
		mcpgo.WithString("name", mcpgo.Required(),
			mcpgo.Description("Prompt name, unique per owner (e.g. 'recruiter-facing').")),
		mcpgo.WithString("body", mcpgo.Required(),
			mcpgo.Description("System prompt fragment; the AI's persona instructions.")),
		mcpgo.WithString("description",
			mcpgo.Description("Optional one-line description of when to use this prompt.")),
	)
}

func invokePromptCreate(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		in, perr := parsePromptCreateParams(req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		return runPromptCreate(ctx, deps, in)
	}
}

func parsePromptCreateParams(
	req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.CreatePromptInput, error) {
	name, err := req.RequireString("name")
	if err != nil {
		return nil, errors.New("name is required")
	}
	body, err := req.RequireString("body")
	if err != nil {
		return nil, errors.New("body is required")
	}
	return &usecases.CreatePromptInput{
		OwnerID: ownerID, Name: name, Body: body,
		Description: req.GetString("description", ""),
	}, nil
}

func runPromptCreate(
	ctx context.Context, deps *Deps, in *usecases.CreatePromptInput,
) *mcpgo.CallToolResult {
	prompt, cerr := usecases.CreatePrompt(ctx, deps.Prompts, in)
	if cerr != nil {
		if errors.Is(cerr, domain.ErrPromptNameTaken) {
			return mcpgo.NewToolResultError("prompt name already taken")
		}
		deps.Log.Error("mcp prompt_create", "err", cerr)
		return mcpgo.NewToolResultError("create prompt failed")
	}
	return marshalResult(deps, promptIDPayload{PromptID: prompt.ID(), Name: prompt.Name()})
}

func promptListTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"prompt_list",
		mcpgo.WithDescription("List the owner's prompts (incl. vanilla builtin)."),
	)
}

func invokePromptList(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		rows, err := usecases.ListPrompts(ctx, deps.Prompts, ownerID)
		if err != nil {
			deps.Log.Error("mcp prompt_list", "err", err)
			return mcpgo.NewToolResultError("list prompts failed")
		}
		items := make(promptRows, 0, len(rows))
		for i := range rows {
			items = append(items, promptRowPayload{
				PromptID: rows[i].ID(), Name: rows[i].Name(),
				Description: rows[i].Description(), IsBuiltin: rows[i].IsBuiltin(),
			})
		}
		return marshalResult(deps, items)
	}
}

func promptDeleteTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"prompt_delete",
		mcpgo.WithDescription("Delete an owner-curated prompt. Vanilla builtin cannot be deleted."),
		mcpgo.WithString("prompt_id", mcpgo.Required(),
			mcpgo.Description("Prompt id returned by prompt_create / prompt_list.")),
	)
}

func invokePromptDelete(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		promptID, err := req.RequireString("prompt_id")
		if err != nil {
			return mcpgo.NewToolResultError("prompt_id is required")
		}
		derr := usecases.DeletePrompt(ctx, deps.Prompts, ownerID, promptID)
		if derr != nil {
			return mapPromptDeleteErr(deps, derr)
		}
		return mcpgo.NewToolResultText(`{"ok":true}`)
	}
}

func mapPromptDeleteErr(deps *Deps, err error) *mcpgo.CallToolResult {
	switch {
	case errors.Is(err, domain.ErrPromptBuiltinImmutable):
		return mcpgo.NewToolResultError("builtin prompt cannot be deleted")
	case errors.Is(err, domain.ErrPromptNotFound):
		return mcpgo.NewToolResultError("prompt not found")
	default:
		deps.Log.Error("mcp prompt_delete", "err", err)
		return mcpgo.NewToolResultError("delete prompt failed")
	}
}

type promptIDPayload struct {
	PromptID string `json:"prompt_id"`
	Name     string `json:"name"`
}

func (p promptIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal prompt id payload: %w", err)
	}
	return b, nil
}

type promptRowPayload struct {
	PromptID    string `json:"prompt_id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	IsBuiltin   bool   `json:"is_builtin,omitempty"`
}

// promptRows —— slice wrapper 满足 payload interface (slice 自身不能挂方法)。
type promptRows []promptRowPayload

func (rs promptRows) marshalJSON() ([]byte, error) {
	b, err := json.Marshal([]promptRowPayload(rs))
	if err != nil {
		return nil, fmt.Errorf("marshal prompt rows: %w", err)
	}
	return b, nil
}
