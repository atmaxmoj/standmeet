// cap_prompts.go —— Phase E-5: owner Prompts CRUD via Capability。
// 3 tools: prompt_create / prompt_list / prompt_delete。owner-only。
// public builtin 不可删，usecase 层拦，cap 翻译成 isError。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

const capPromptsBundle = "prompts.bundle"

type promptsCapability struct {
	prompts *owner.PromptsDeps
	log     *slog.Logger
}

func newPromptsCapability(
	prompts *owner.PromptsDeps, log *slog.Logger,
) *promptsCapability {
	return &promptsCapability{prompts: prompts, log: log}
}

func (*promptsCapability) ID() string          { return capPromptsBundle }
func (*promptsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*promptsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*promptsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*promptsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *promptsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.createBinding(), c.listBinding(), c.deleteBinding(),
		c.updateBinding(), c.getBinding(),
	}
}

// ───── prompt_create ──────────────────────────────────────────────

func (c *promptsCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
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
) capreg.MCPResult {
	var args promptCreateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Name == "" {
		return capreg.MCPError("name is required")
	}
	if args.Body == "" {
		return capreg.MCPError("body is required")
	}
	prompt, err := owner.CreatePrompt(ctx, *c.prompts, &owner.CreatePromptInputReq{
		OwnerID: ownerID, Name: args.Name, Body: args.Body,
		Description: args.Description,
	})
	if err != nil {
		return promptCreateErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "prompt_create", map[string]string{
		"prompt_id": prompt.ID(), "name": prompt.Name(),
	})
}

func promptCreateErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, owner.ErrPromptNameTaken) {
		return capreg.MCPError("prompt name already taken")
	}
	log.Error("cap prompt_create", "err", err)
	return capreg.MCPError("create prompt failed")
}

// ───── prompt_list ───────────────────────────────────────────────

func (c *promptsCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "prompt_list",
		Description: "List the owner's prompts (incl. public builtin).",
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
) capreg.MCPResult {
	rows, err := owner.ListPrompts(ctx, *c.prompts, ownerID)
	if err != nil {
		c.log.Error("cap prompt_list", "err", err)
		return capreg.MCPError("list prompts failed")
	}
	items := make([]promptListRow, 0, len(rows))
	for i := range rows {
		items = append(items, promptListRow{
			PromptID: rows[i].ID(), Name: rows[i].Name(),
			Description: rows[i].Description(), IsBuiltin: rows[i].IsBuiltin(),
		})
	}
	return mcputil.MarshalResult(c.log, "prompt_list", items)
}

// ───── prompt_delete ─────────────────────────────────────────────

func (c *promptsCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "prompt_delete",
		Description: "Delete an owner-curated prompt. Public builtin cannot be deleted.",
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
) capreg.MCPResult {
	var args promptDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.PromptID == "" {
		return capreg.MCPError("prompt_id is required")
	}
	if err := owner.DeletePrompt(ctx, *c.prompts, ownerID, args.PromptID); err != nil {
		return promptDeleteErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "prompt_delete", map[string]bool{"ok": true})
}

func promptDeleteErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, owner.ErrPromptBuiltinImmutable) {
		return capreg.MCPError("builtin prompt cannot be deleted")
	}
	if errors.Is(err, owner.ErrPromptNotFound) {
		return capreg.MCPError("prompt not found")
	}
	log.Error("cap prompt_delete", "err", err)
	return capreg.MCPError(fmt.Sprintf("delete prompt failed: %v", err))
}

// ───── prompt_update ─────────────────────────────────────────────

func (c *promptsCapability) updateBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "prompt_update",
		Description: "Update an owner-curated Prompt. Mirrors prompt_create fields " +
			"plus prompt_id. Builtin (public) prompt can be edited but not renamed.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"prompt_id":{"type":"string","description":"Target prompt id."},
				"name":{"type":"string",
					"description":"Prompt name, unique per owner."},
				"body":{"type":"string",
					"description":"System prompt fragment; the AI's persona instructions."},
				"description":{"type":"string",
					"description":"Optional one-line description of when to use this prompt."}
			},
			"required":["prompt_id","name","body"]
		}`),
		Handler: c.handleUpdate,
	}
}

type promptUpdateArgsWire struct {
	PromptID    string `json:"prompt_id"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	Description string `json:"description"`
}

func parsePromptUpdateArgs(raw json.RawMessage) (promptUpdateArgsWire, error) {
	var args promptUpdateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.PromptID == "" {
		return args, errors.New("prompt_id is required")
	}
	if args.Name == "" {
		return args, errors.New("name is required")
	}
	if args.Body == "" {
		return args, errors.New("body is required")
	}
	return args, nil
}

func (c *promptsCapability) handleUpdate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parsePromptUpdateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	prompt, err := owner.UpdatePrompt(ctx, *c.prompts, &owner.UpdatePromptInputReq{
		OwnerID: ownerID, PromptID: args.PromptID, Name: args.Name,
		Body: args.Body, Description: args.Description,
	})
	if err != nil {
		return promptUpdateErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "prompt_update", promptToCapView(&prompt))
}

func promptUpdateErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, owner.ErrPromptBuiltinImmutable) {
		return capreg.MCPError("builtin prompt cannot be renamed")
	}
	if errors.Is(err, owner.ErrPromptNameTaken) {
		return capreg.MCPError("prompt name already taken")
	}
	if errors.Is(err, owner.ErrPromptNotFound) {
		return capreg.MCPError("prompt not found")
	}
	log.Error("cap prompt_update", "err", err)
	return capreg.MCPError("update prompt failed")
}

// ───── prompts.get ───────────────────────────────────────────────

func (c *promptsCapability) getBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "prompts.get",
		Description: "Fetch one prompt by id (incl. body).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"prompt_id":{"type":"string","description":"Prompt id"}
			},
			"required":["prompt_id"]
		}`),
		Handler: c.handleGet,
	}
}

type promptGetArgsWire struct {
	PromptID string `json:"prompt_id"`
}

func (c *promptsCapability) handleGet(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args promptGetArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.PromptID == "" {
		return capreg.MCPError("prompt_id is required")
	}
	prompt, err := owner.GetPrompt(ctx, *c.prompts, ownerID, args.PromptID)
	if err != nil {
		if errors.Is(err, owner.ErrPromptNotFound) {
			return capreg.MCPError("prompt not found")
		}
		c.log.Error("cap prompts.get", "err", err)
		return capreg.MCPError("get prompt failed")
	}
	return mcputil.MarshalResult(c.log, "prompts.get", promptToCapView(&prompt))
}

func promptToCapView(p *owner.Prompt) map[string]any {
	return map[string]any{
		"prompt_id": p.ID(), "name": p.Name(), "body": p.Body(),
		"description": p.Description(), "is_builtin": p.IsBuiltin(),
	}
}
