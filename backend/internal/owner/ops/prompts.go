// prompts.go —— owner 写的 system prompt 片段(AI 的人格指令),挂到 role / 邀请码上
// 决定访客见到的那个 AI 怎么说话。内置的那几条不许改名、不许删。
//
// 迁移前两个面的载荷各写各的:MCP 的 prompt_list 只给 {prompt_id,name,description,
// is_builtin} —— **没有 body**,owner 从 Claude Code 列一遍看不到自己写的正文;
// create 只回 {prompt_id,name};delete 回 {ok:true}。面板那边一直是完整的一条。现在一份。
//
// op 的 id 就是 MCP 工具名,保持历史名字(prompt_create / prompts.get 这种不一致也保持)。

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

// Prompts —— list / get / create / update / delete。
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

// create 和 update 的 schema 只差一个必填的 prompt_id。共用字段写一次。
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

// promptOut —— 一条 prompt 的出站形状(两个面同一份)。
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

// promptErr —— 域的哨兵 → 协议无关的类别。内置 prompt 不许改名/删是 403 而不是 400:
// 请求没写错,东西也在,就是不许这么动。code 是已经发出去的契约,显式钉住。
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
