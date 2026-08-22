// skills.go —— owner 自己攒的 AI skill(附加 system prompt + 可选沙箱脚本),挂到
// role / 邀请码上就组成访客看到的那个 AI。
//
// 迁移时两个面的载荷本来**不一样**:面板回完整的 skill(带 allowed_tools / enabled),
// MCP 的 skill_list 少这两个字段 —— owner 从 Claude Code 看不出一个 skill 是不是被关掉了。
// 现在一份形状(面板那份是已经发出去的契约),盲点自然没了。
//
// op 的 id 就是 MCP 工具名,保持历史名字(skill_create 而不是 skills.create)。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/usecase"
)

// Skills —— list / create / set_enabled / delete。
func Skills(deps usecase.SkillsDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "skill_list",
			Description: "List every owner skill (builtin and curated), with its enabled state.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listSkills(deps),
		},
		{
			ID: "skill_create",
			Description: "Create an owner-curated AI skill: an extra system prompt plus " +
				"optional sandbox scripts. Attach it to invite codes to compose the " +
				"visitor-facing persona and capability set.",
			InputSchema: skillCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createSkill(deps),
		},
		{
			ID: "skill_update",
			Description: "Edit an owner-curated skill: its prompt, its description, and " +
				"which tools it may call. Naming a connector operation here is what lets a " +
				"visitor's AI reach an uploaded connector. Builtin skills cannot be edited.",
			InputSchema: skillUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateSkill(deps),
		},
		{
			ID: "skill_set_enabled",
			Description: "Globally enable or disable a skill. A disabled skill never enters " +
				"the agent, even when a role attaches it. Builtin skills can be toggled; " +
				"only deleting them is blocked.",
			InputSchema: skillEnabledSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setSkillEnabled(deps),
		},
		{
			ID:          "skill_delete",
			Description: "Delete an owner-curated skill. Builtin skills cannot be deleted.",
			InputSchema: skillIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteSkill(deps),
		},
	}
}

var (
	skillIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"skill_id":{"type":"string","description":"Skill id."}},
		"required":["skill_id"]
	}`)

	skillEnabledSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"skill_id":{"type":"string","description":"Skill id."},
			"enabled":{"type":"boolean","description":"true to enable, false to disable."}
		},
		"required":["skill_id","enabled"]
	}`)

	skillUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"skill_id":{"type":"string","description":"Skill id."},
			"name":{"type":"string","description":"Skill name, unique per owner."},
			"prompt":{"type":"string",
				"description":"System prompt fragment appended to the base persona."},
			"description":{"type":"string","description":"Optional one-line description."},
			"allowed_tools":{"type":"array","items":{"type":"string"},
				"description":
				"Tool ids unlocked on roles with this skill; see connectors.agent_ops."}
		},
		"required":["skill_id","name","prompt"]
	}`)

	skillCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"name":{"type":"string","description":"Skill name, unique per owner."},
			"prompt":{"type":"string",
				"description":"System prompt fragment appended to the base persona."},
			"description":{"type":"string","description":"Optional one-line description."},
			"allowed_tools":{"type":"array","items":{"type":"string"},
				"description":"Capability ids unlocked on roles, e.g. calendar.book."},
			"scripts":{"type":"array","items":{"type":"object"},
				"description":"Optional sandbox scripts; each {filename,language,content,...}."}
		},
		"required":["name","prompt"]
	}`)
)

// skillOut —— 出站形状(两个面同一份)。
type skillOut struct {
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

func toSkillOut(s *entity.Skill) skillOut {
	tools := s.AllowedTools
	if tools == nil {
		tools = []string{}
	}
	return skillOut{
		ID: s.ID, Name: s.Name, Description: s.Description, Prompt: s.Prompt,
		Source: s.Source, IsBuiltin: s.IsBuiltin, Enabled: s.Enabled,
		AllowedTools: tools, CreatedAt: s.CreatedAt.Format(time.RFC3339),
	}
}

func listSkills(deps usecase.SkillsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListSkills(ctx, deps, ownerID)
		if err != nil {
			return nil, skillErr(err)
		}
		out := make([]skillOut, 0, len(rows))
		for i := range rows {
			out = append(out, toSkillOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

type skillArgs struct {
	Scripts      []entity.SkillScript `json:"scripts"`
	Name         string               `json:"name"`
	Prompt       string               `json:"prompt"`
	Description  string               `json:"description"`
	SkillID      string               `json:"skill_id"`
	AllowedTools []string             `json:"allowed_tools"`
	Enabled      bool                 `json:"enabled"`
}

func decodeSkillArgs(raw json.RawMessage) (skillArgs, error) {
	var in skillArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func createSkill(deps usecase.SkillsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSkillCreate(raw)
		if perr != nil {
			return nil, perr
		}
		skill, err := usecase.CreateSkill(ctx, deps, &usecase.CreateSkillReq{
			OwnerID: ownerID, Name: in.Name, Description: in.Description,
			Prompt: in.Prompt, AllowedTools: in.AllowedTools, Scripts: in.Scripts,
		})
		if err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(toSkillOut(&skill))
	}
}

func updateSkill(deps usecase.SkillsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSkillUpdate(raw)
		if perr != nil {
			return nil, perr
		}
		skill, err := usecase.UpdateSkill(ctx, deps, &usecase.UpdateSkillReq{
			OwnerID: ownerID, SkillID: in.SkillID, Name: in.Name,
			Description: in.Description, Prompt: in.Prompt, AllowedTools: in.AllowedTools,
		})
		if err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(toSkillOut(&skill))
	}
}

func decodeSkillUpdate(raw json.RawMessage) (skillArgs, error) {
	in, perr := decodeSkillArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs(
		[2]string{"skill_id", in.SkillID},
		[2]string{"name", in.Name},
		[2]string{"prompt", in.Prompt},
	)
}

func decodeSkillCreate(raw json.RawMessage) (skillArgs, error) {
	in, perr := decodeSkillArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs([2]string{"name", in.Name}, [2]string{"prompt", in.Prompt})
}

func setSkillEnabled(deps usecase.SkillsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSkillID(raw)
		if perr != nil {
			return nil, perr
		}
		skill, err := usecase.SetSkillEnabled(ctx, deps, ownerID, in.SkillID, in.Enabled)
		if err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(toSkillOut(&skill))
	}
}

func deleteSkill(deps usecase.SkillsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSkillID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeleteSkill(ctx, deps, ownerID, in.SkillID); err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(map[string]string{"skill_id": in.SkillID})
	}
}

func decodeSkillID(raw json.RawMessage) (skillArgs, error) {
	in, perr := decodeSkillArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs([2]string{"skill_id", in.SkillID})
}

// skillErr —— 域的哨兵 → 协议无关的类别。code 是已经发出去的契约,显式钉住。
func skillErr(err error) error {
	for _, c := range skillErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("skill op", err)
}

var skillErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("name and prompt are required")
	}},
	{entity.ErrSkillNameTaken, func() error {
		return fp.Coded(
			fp.Conflict("a skill with that name is already installed"), "skill_name_taken")
	}},
	// 措辞不说「删」—— 同一个哨兵现在也管编辑，而「删不掉」对一个想改 prompt 的 owner
	// 是一句不相干的话（[[collapsed-error-class-kills-its-own-branch]] 的同族）。
	{entity.ErrSkillBuiltinImmutable, func() error {
		return fp.Coded(
			fp.Forbidden("a builtin skill cannot be edited or deleted — "+
				"install a copy to change it"),
			"skill_builtin_immutable")
	}},
}
