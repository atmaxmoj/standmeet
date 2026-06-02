// cap_prompts.go —— Phase E-5: owner Prompts CRUD via Capability。
// 3 tools: prompt_create / prompt_list / prompt_delete。owner-only。
// vanilla builtin 不可删，usecase 层拦，cap 翻译成 isError。

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

const capPromptsBundle = "prompts.bundle"

type promptsCapability struct {
	prompts *usecases.PromptsDeps
	log     *slog.Logger
}

func newPromptsCapability(
	prompts *usecases.PromptsDeps, log *slog.Logger,
) *promptsCapability {
	return &promptsCapability{prompts: prompts, log: log}
}

func (*promptsCapability) ID() string               { return capPromptsBundle }
func (*promptsCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*promptsCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return nil, agentskills.ErrHidden
}

func (*promptsCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (*promptsCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *promptsCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{
		c.createBinding(), c.listBinding(), c.deleteBinding(),
	}
}

// ───── prompt_create ──────────────────────────────────────────────

func (c *promptsCapability) createBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "prompt_create",
		Description: "Create an owner-curated Prompt (persona / instruction " +
			"fragment library). Roles reference prompts; visitor sessions snapshot the " +
			"prompt body into RoleSnapshot.PromptBody at session start.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"name":{"type":"string",
					"description":"Prompt name, unique per owner."},
				"body":{"type":"string",
					"description":"System prompt fragment; the AI's persona instructions."},
				"description":{"type":"string",
					"description":"Optional one-line description of when to use this prompt."}
			},
			"required":["name","body"]
		}`),
		Handler: c.handleCreate,
	}
}

type promptCreateArgsWire struct {
	Name        string `json:"name"`
	Body        string `json:"body"`
	Description string `json:"description"`
}

func (c *promptsCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	var args promptCreateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.Name == "" {
		return agentskills.MCPError("name is required")
	}
	if args.Body == "" {
		return agentskills.MCPError("body is required")
	}
	prompt, err := usecases.CreatePrompt(ctx, *c.prompts, &usecases.CreatePromptInput{
		OwnerID: ownerID, Name: args.Name, Body: args.Body,
		Description: args.Description,
	})
	if err != nil {
		return promptCreateErrToResult(c.log, err)
	}
	return marshalCapResult(c.log, "prompt_create", map[string]string{
		"prompt_id": prompt.ID(), "name": prompt.Name(),
	})
}

func promptCreateErrToResult(log *slog.Logger, err error) agentskills.MCPResult {
	if errors.Is(err, domain.ErrPromptNameTaken) {
		return agentskills.MCPError("prompt name already taken")
	}
	log.Error("cap prompt_create", "err", err)
	return agentskills.MCPError("create prompt failed")
}

// ───── prompt_list ───────────────────────────────────────────────

func (c *promptsCapability) listBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "prompt_list",
		Description: "List the owner's prompts (incl. vanilla builtin).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type promptListRow struct {
	PromptID    string `json:"prompt_id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	IsBuiltin   bool   `json:"is_builtin,omitempty"`
}

func (c *promptsCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) agentskills.MCPResult {
	rows, err := usecases.ListPrompts(ctx, *c.prompts, ownerID)
	if err != nil {
		c.log.Error("cap prompt_list", "err", err)
		return agentskills.MCPError("list prompts failed")
	}
	items := make([]promptListRow, 0, len(rows))
	for i := range rows {
		items = append(items, promptListRow{
			PromptID: rows[i].ID(), Name: rows[i].Name(),
			Description: rows[i].Description(), IsBuiltin: rows[i].IsBuiltin(),
		})
	}
	return marshalCapResult(c.log, "prompt_list", items)
}

// ───── prompt_delete ─────────────────────────────────────────────

func (c *promptsCapability) deleteBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "prompt_delete",
		Description: "Delete an owner-curated prompt. Vanilla builtin cannot be deleted.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"prompt_id":{"type":"string","description":"Prompt id"}
			},
			"required":["prompt_id"]
		}`),
		Handler: c.handleDelete,
	}
}

type promptDeleteArgsWire struct {
	PromptID string `json:"prompt_id"`
}

func (c *promptsCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	var args promptDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.PromptID == "" {
		return agentskills.MCPError("prompt_id is required")
	}
	if err := usecases.DeletePrompt(ctx, *c.prompts, ownerID, args.PromptID); err != nil {
		return promptDeleteErrToResult(c.log, err)
	}
	return marshalCapResult(c.log, "prompt_delete", map[string]bool{"ok": true})
}

func promptDeleteErrToResult(log *slog.Logger, err error) agentskills.MCPResult {
	if errors.Is(err, domain.ErrPromptBuiltinImmutable) {
		return agentskills.MCPError("builtin prompt cannot be deleted")
	}
	if errors.Is(err, domain.ErrPromptNotFound) {
		return agentskills.MCPError("prompt not found")
	}
	log.Error("cap prompt_delete", "err", err)
	return agentskills.MCPError(fmt.Sprintf("delete prompt failed: %v", err))
}
