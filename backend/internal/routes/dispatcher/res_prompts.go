// res_prompts.go —— 资源 prompts:owner 写的 system prompt 片段(AI 的人格指令),
// 挂到 role / 邀请码上决定访客见到的那个 AI 怎么说话。内置的那几条不许改名、不许删。
//
// 迁移前两个面的载荷各写各的:MCP 的 prompt_list 只给 {prompt_id,name,description,is_builtin}
// —— **没有 body**,owner 从 Claude Code 列一遍看不到自己写的正文;create 只回
// {prompt_id,name};delete 回 {ok:true}。admin 那边一直是完整的 prompt。现在只有一份。
//
// op 的 id 就是 MCP 工具名,保持历史名字(prompt_create / prompts.get 这种不一致也保持:
// 改名等于改 owner 客户端已经在用的接口)。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// PromptStore —— prompts 这组操作所需的最小口。
type PromptStore interface {
	List(ctx context.Context, ownerID string) ([]Prompt, error)
	Get(ctx context.Context, ownerID, id string) (Prompt, error)
	Create(ctx context.Context, in *WritePrompt) (Prompt, error)
	Update(ctx context.Context, in *WritePrompt) (Prompt, error)
	Delete(ctx context.Context, ownerID, id string) error
}

// Prompt —— 一条 prompt 在收口这一层的形状。
type Prompt struct {
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ID          string
	Name        string
	Description string
	Body        string
	IsBuiltin   bool
}

// WritePrompt —— 建 / 改一条 prompt 的入参(ID 空 = 建)。
type WritePrompt struct {
	OwnerID     string
	ID          string
	Name        string
	Body        string
	Description string
}

// Prompts —— prompts 资源:list / get / create / update / delete。
func Prompts(store PromptStore) Resource {
	return Resource{Name: "prompts", Ops: []Op{
		{
			ID:          "prompt_list",
			Description: "List every owner prompt (builtin + curated), with its body.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      promptsList(store),
		},
		{
			ID:          "prompts.get",
			Description: "Read one prompt in full by id.",
			InputSchema: promptIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      promptsGet(store),
		},
		{
			ID: "prompt_create",
			Description: "Create an owner prompt: a system-prompt fragment that shapes the " +
				"visitor-facing AI's persona.",
			InputSchema: promptCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promptsWrite(store.Create, parsePromptCreate),
		},
		{
			ID:          "prompt_update",
			Description: "Update an owner prompt. Builtin prompts cannot be renamed.",
			InputSchema: promptUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promptsWrite(store.Update, parsePromptUpdate),
		},
		{
			ID:          "prompt_delete",
			Description: "Delete an owner prompt. Builtin prompts cannot be deleted.",
			InputSchema: promptIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promptsDelete(store),
		},
	}}
}

var promptIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"prompt_id":{"type":"string","description":"Prompt id"}},
	"required":["prompt_id"]
}`)

// create 和 update 的 schema 只差一个必填的 prompt_id。共用的那几个字段写一次。
const promptWriteProps = `
	"name":{"type":"string","description":"Prompt name, unique per owner."},
	"body":{"type":"string",
		"description":"System prompt fragment; the AI's persona instructions."},
	"description":{"type":"string",
		"description":"Optional one-line description of when to use this prompt."}`

var promptCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{` + promptWriteProps + `},
	"required":["name","body"]
}`)

var promptUpdateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"prompt_id":{"type":"string","description":"Target prompt id."},` + promptWriteProps + `},
	"required":["prompt_id","name","body"]
}`)

// promptRow —— 出站载荷形状(两个面同一份)。
type promptRow struct {
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Body        string `json:"body"`
	IsBuiltin   bool   `json:"is_builtin"`
}

func toPromptRow(p *Prompt) promptRow {
	return promptRow{
		ID: p.ID, Name: p.Name, Description: p.Description, Body: p.Body,
		IsBuiltin: p.IsBuiltin,
		CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func promptsList(store PromptStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list prompts: %w", err)
		}
		out := make([]promptRow, 0, len(rows))
		for i := range rows {
			out = append(out, toPromptRow(&rows[i]))
		}
		return marshalOut(out)
	}
}

type promptIDArgs struct {
	PromptID string `json:"prompt_id"`
}

func parsePromptID(raw json.RawMessage) (string, error) {
	var in promptIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", BadInput("invalid arguments: " + err.Error())
	}
	if in.PromptID == "" {
		return "", BadInput("prompt_id is required")
	}
	return in.PromptID, nil
}

func promptsGet(store PromptStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parsePromptID(raw)
		if perr != nil {
			return nil, perr
		}
		p, err := store.Get(ctx, ownerID, id)
		if err != nil {
			return nil, fmt.Errorf("get prompt: %w", err)
		}
		row := toPromptRow(&p)
		return marshalOut(row)
	}
}

type promptWriteArgs struct {
	PromptID    string `json:"prompt_id"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	Description string `json:"description"`
}

func parsePromptCreate(raw json.RawMessage) (promptWriteArgs, error) {
	var in promptWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if in.Name == "" {
		return in, BadInput("name is required")
	}
	if in.Body == "" {
		return in, BadInput("body is required")
	}
	return in, nil
}

// parsePromptUpdate —— 跟 create 一样,外加必填的 prompt_id。
func parsePromptUpdate(raw json.RawMessage) (promptWriteArgs, error) {
	in, err := parsePromptCreate(raw)
	if err != nil {
		return in, err
	}
	if in.PromptID == "" {
		return in, BadInput("prompt_id is required")
	}
	return in, nil
}

// promptsWrite —— create 和 update 的回包形状是同一份,只差调哪个函数、怎么校验。
func promptsWrite(
	apply func(ctx context.Context, in *WritePrompt) (Prompt, error),
	parse func(json.RawMessage) (promptWriteArgs, error),
) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parse(raw)
		if perr != nil {
			return nil, perr
		}
		p, err := apply(ctx, &WritePrompt{
			OwnerID: ownerID, ID: in.PromptID, Name: in.Name,
			Body: in.Body, Description: in.Description,
		})
		if err != nil {
			return nil, fmt.Errorf("write prompt: %w", err)
		}
		row := toPromptRow(&p)
		return marshalOut(row)
	}
}

func promptsDelete(store PromptStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parsePromptID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := store.Delete(ctx, ownerID, id); err != nil {
			return nil, fmt.Errorf("delete prompt: %w", err)
		}
		return marshalOut(map[string]bool{"ok": true})
	}
}
