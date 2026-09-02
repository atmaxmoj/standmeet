// skills.go — an owner-curated AI skill (extra system prompt plus optional sandbox
// scripts). Attaching it to a role / invite code composes the AI a visitor sees.
//
// During migration the two faces' payloads used to **differ**: the panel returned
// the full skill (with allowed_tools / enabled), while MCP's skill_list was missing
// those two fields — an owner looking from Claude Code couldn't tell whether a skill
// was turned off. Now it's one shape (the panel's is the already-shipped contract),
// so that blind spot is gone.
//
// An op's id is the MCP tool name; it keeps the historical name (skill_create,
// not skills.create).

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

// Skills — list / create / set_enabled / delete.
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

// skillOut — the outbound shape (the same one for both faces).
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

// skillErr — domain sentinel → protocol-agnostic category. The code is an
// already-shipped contract, pinned explicitly.
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
	// The wording avoids "delete" — this same sentinel now also covers edit, and
	// "can't delete it" is irrelevant to an owner who just wants to change the
	// prompt (same family as [[collapsed-error-class-kills-its-own-branch]]).
	{entity.ErrSkillBuiltinImmutable, func() error {
		return fp.Coded(
			fp.Forbidden("a builtin skill cannot be edited or deleted — "+
				"install a copy to change it"),
			"skill_builtin_immutable")
	}},
}
