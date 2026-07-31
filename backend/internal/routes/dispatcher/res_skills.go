// res_skills.go —— 资源 skills:owner 自己攒的 AI skill(附加 system prompt + 可选沙箱脚本),
// 挂到 role / 邀请码上就组成访客看到的那个 AI。
//
// 迁移时两个面的载荷本来是**不一样**的:admin 回完整的 skill(带 allowed_tools / enabled),
// MCP 的 skill_list 少了这两个字段 —— 于是 owner 从 Claude Code 看不出一个 skill 是不是被关掉了。
// 现在只有一份形状(取并集,admin 那份是已经发出去的契约),两个面都拿到它,那个盲点自然没了。
//
// op 的 id 就是 MCP 工具名,所以这里保持历史名字(skill_create 而不是 skills.create):
// 改名等于改 owner 客户端已经在用的公开接口,不是这轮该做的事。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// SkillStore —— skills 这组操作所需的最小口。
type SkillStore interface {
	List(ctx context.Context, ownerID string) ([]Skill, error)
	Create(ctx context.Context, in *CreateSkill) (Skill, error)
	SetEnabled(ctx context.Context, ownerID, id string, enabled bool) (Skill, error)
	Delete(ctx context.Context, ownerID, id string) error
}

// Skill —— 一个 skill 在收口这一层的形状。
type Skill struct {
	CreatedAt    time.Time
	ID           string
	Name         string
	Description  string
	Prompt       string
	Source       string
	AllowedTools []string
	IsBuiltin    bool
	Enabled      bool
}

// CreateSkill —— 建一个 skill 的入参。Scripts 原样透传:收口不需要看懂沙箱脚本的结构,
// 只需要把它交给域 —— 少一份要跟着域演进的形状复制。
type CreateSkill struct {
	Scripts      json.RawMessage
	OwnerID      string
	Name         string
	Prompt       string
	Description  string
	AllowedTools []string
}

// Skills —— skills 资源:list / create / set_enabled / delete。
func Skills(store SkillStore) Resource {
	return Resource{Name: "skills", Ops: []Op{
		{
			ID:          "skill_list",
			Description: "List every owner skill (builtin + curated), with its enabled state.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      skillsList(store),
		},
		{
			ID: "skill_create",
			Description: "Create an owner-curated AI skill (extra system prompt + optional " +
				"sandbox scripts). Attach to invite codes to compose the visitor-facing " +
				"AI persona + capability set.",
			InputSchema: skillCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      skillsCreate(store),
		},
		{
			ID: "skill_set_enabled",
			Description: "Globally enable or disable a skill. Disabled skills never enter " +
				"the agent even when attached to a role. Builtin skills can be toggled " +
				"(only deletion is blocked).",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"skill_id":{"type":"string","description":"Skill id"},
					"enabled":{"type":"boolean","description":"true to enable, false to disable."}
				},
				"required":["skill_id","enabled"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: skillsSetEnabled(store),
		},
		{
			ID:          "skill_delete",
			Description: "Delete an owner-curated skill. Builtin skills cannot be deleted.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"skill_id":{"type":"string","description":"Skill id"}},
				"required":["skill_id"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: skillsDelete(store),
		},
	}}
}

var skillCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"name":{"type":"string","description":"Skill name, unique per owner."},
		"prompt":{"type":"string",
			"description":"System prompt fragment appended to base persona."},
		"description":{"type":"string","description":"Optional one-line description."},
		"allowed_tools":{"type":"array","items":{"type":"string"},
			"description":"Capability IDs unlocked on roles (e.g. calendar.book)."},
		"scripts":{"type":"array","items":{"type":"object"},
			"description":"Optional sandbox scripts; each {filename,language,content,...}."}
	},
	"required":["name","prompt"]
}`)

// skillRow —— 出站载荷形状(两个面同一份;admin 已发出去的契约就是它)。
type skillRow struct {
	CreatedAt    string   `json:"created_at"`
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Prompt       string   `json:"prompt"`
	Source       string   `json:"source"`
	AllowedTools []string `json:"allowed_tools"`
	IsBuiltin    bool     `json:"is_builtin"`
	Enabled      bool     `json:"enabled"`
}

func toSkillRow(s *Skill) skillRow {
	tools := s.AllowedTools
	if tools == nil {
		tools = []string{}
	}
	return skillRow{
		ID: s.ID, Name: s.Name, Description: s.Description, Prompt: s.Prompt,
		Source: s.Source, IsBuiltin: s.IsBuiltin, Enabled: s.Enabled,
		AllowedTools: tools, CreatedAt: s.CreatedAt.Format(time.RFC3339),
	}
}

func skillsList(store SkillStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list skills: %w", err)
		}
		out := make([]skillRow, 0, len(rows))
		for i := range rows {
			out = append(out, toSkillRow(&rows[i]))
		}
		return marshalOut(out)
	}
}

type skillCreateArgs struct {
	Scripts      json.RawMessage `json:"scripts"`
	Name         string          `json:"name"`
	Prompt       string          `json:"prompt"`
	Description  string          `json:"description"`
	AllowedTools []string        `json:"allowed_tools"`
}

func parseSkillCreate(raw json.RawMessage) (skillCreateArgs, error) {
	var in skillCreateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if in.Name == "" {
		return in, BadInput("name is required")
	}
	if in.Prompt == "" {
		return in, BadInput("prompt is required")
	}
	return in, nil
}

func skillsCreate(store SkillStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseSkillCreate(raw)
		if perr != nil {
			return nil, perr
		}
		skill, err := store.Create(ctx, &CreateSkill{
			OwnerID: ownerID, Name: in.Name, Prompt: in.Prompt,
			Description: in.Description, AllowedTools: in.AllowedTools, Scripts: in.Scripts,
		})
		if err != nil {
			return nil, fmt.Errorf("create skill: %w", err)
		}
		row := toSkillRow(&skill)
		return marshalOut(row)
	}
}

type skillEnabledArgs struct {
	SkillID string `json:"skill_id"`
	Enabled bool   `json:"enabled"`
}

func skillsSetEnabled(store SkillStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in skillEnabledArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.SkillID == "" {
			return nil, BadInput("skill_id is required")
		}
		skill, err := store.SetEnabled(ctx, ownerID, in.SkillID, in.Enabled)
		if err != nil {
			return nil, fmt.Errorf("set skill enabled: %w", err)
		}
		row := toSkillRow(&skill)
		return marshalOut(row)
	}
}

type skillIDArgs struct {
	SkillID string `json:"skill_id"`
}

func skillsDelete(store SkillStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in skillIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.SkillID == "" {
			return nil, BadInput("skill_id is required")
		}
		if err := store.Delete(ctx, ownerID, in.SkillID); err != nil {
			return nil, fmt.Errorf("delete skill: %w", err)
		}
		return marshalOut(map[string]string{"skill_id": in.SkillID})
	}
}
