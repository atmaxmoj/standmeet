// prompts.go —— system-prompt fragments the owner writes (the AI's persona instructions),
// attached to a role / access code to decide how the visitor-facing AI speaks. The builtin
// ones cannot be renamed or deleted.
//
// Before the migration each face wrote its own payload: MCP's prompt_list returned only
// {prompt_id,name,description,is_builtin} — **no body**, so listing from Claude Code
// couldn't show the owner what they'd actually written; create returned only
// {prompt_id,name}; delete returned {ok:true}. The panel always had the full entry. Now
// there's one shape.
//
// The op's id is the MCP tool name; historical names are kept (including the inconsistency
// between prompt_create and prompts.get).

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Prompts —— list / get / create / update / delete.
func Prompts(deps usecase.PromptsDeps) []fp.Op {
	return append(promptReadOps(deps), promptWriteOps(deps)...)
}

func promptReadOps(deps usecase.PromptsDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "prompt_list",
			Description: "List every owner prompt, builtin and curated, with its body.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listPrompts(deps),
		},
		{
			ID:          "prompts.get",
			Description: "Read one prompt in full by id.",
			InputSchema: promptIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getPrompt(deps),
		},
	}
}

func promptWriteOps(deps usecase.PromptsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "prompt_create",
			Description: "Create an owner prompt: a system-prompt fragment that shapes the " +
				"visitor-facing AI's persona.",
			InputSchema: promptCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createPrompt(deps),
		},
		{
			ID:          "prompt_update",
			Description: "Update an owner prompt. Builtin prompts cannot be renamed.",
			InputSchema: promptUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updatePrompt(deps),
		},
		{
			ID:          "prompt_delete",
			Description: "Delete an owner prompt. Builtin prompts cannot be deleted.",
			InputSchema: promptIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deletePrompt(deps),
		},
	}
}

var promptIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"prompt_id":{"type":"string","description":"Prompt id."}},
	"required":["prompt_id"]
}`)

// create's and update's schemas differ only by a required prompt_id. Shared fields are
// written once.
const promptWriteProps = `
	"name":{"type":"string","description":"Prompt name, unique per owner."},
	"body":{"type":"string",
		"description":"System prompt fragment; the AI's persona instructions."},
	"description":{"type":"string",
		"description":"Optional one-line description of when to use this prompt."}`

var (
	promptCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{` + promptWriteProps + `},
		"required":["name","body"]
	}`)

	promptUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"prompt_id":{"type":"string","description":"Target prompt id."},` +
		promptWriteProps + `},
		"required":["prompt_id","name","body"]
	}`)
)

// promptOut —— outbound shape for one prompt (same for both faces).
type promptOut struct {
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Body        string `json:"body"`
	IsBuiltin   bool   `json:"is_builtin"`
}

func toPromptOut(p *entity.Prompt) promptOut {
	return promptOut{
		ID: p.ID(), Name: p.Name(), Description: p.Description(), Body: p.Body(),
		IsBuiltin: p.IsBuiltin(),
		CreatedAt: p.CreatedAt().UTC().Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt().UTC().Format(time.RFC3339),
	}
}

func listPrompts(deps usecase.PromptsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListPrompts(ctx, deps, ownerID)
		if err != nil {
			return nil, promptErr(err)
		}
		out := make([]promptOut, 0, len(rows))
		for i := range rows {
			out = append(out, toPromptOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

func getPrompt(deps usecase.PromptsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parsePromptID(raw)
		if perr != nil {
			return nil, perr
		}
		p, err := usecase.GetPrompt(ctx, deps, ownerID, id)
		if err != nil {
			return nil, promptErr(err)
		}
		return json.Marshal(toPromptOut(&p))
	}
}

func deletePrompt(deps usecase.PromptsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parsePromptID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeletePrompt(ctx, deps, ownerID, id); err != nil {
			return nil, promptErr(err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

type promptIDArgs struct {
	PromptID string `json:"prompt_id"`
}

func parsePromptID(raw json.RawMessage) (string, error) {
	var in promptIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"prompt_id", in.PromptID}); err != nil {
		return "", err
	}
	return in.PromptID, nil
}

// promptErr —— domain sentinels → protocol-agnostic categories. A builtin prompt refusing
// rename/delete is a 403, not a 400: the request wasn't malformed and the thing exists, it's
// just not allowed. code is an already-published contract, pinned down explicitly.
func promptErr(err error) error {
	for _, c := range promptErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("prompt op", err)
}

var promptErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error { return fp.BadInput("name is required") }},
	{entity.ErrPromptNotFound, func() error {
		return fp.Coded(fp.NotFound("prompt not found"), "prompt_not_found")
	}},
	{entity.ErrPromptNameTaken, func() error {
		return fp.Coded(fp.Conflict("prompt name already taken"), "prompt_name_taken")
	}},
	{entity.ErrPromptBuiltinImmutable, func() error {
		return fp.Coded(
			fp.Forbidden("builtin prompt cannot be renamed or deleted"),
			"prompt_builtin_immutable")
	}},
}
