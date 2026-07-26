// cap_skills.go —— Phase E-8: owner Skills CRUD via Capability。
// 3 tools: skill_create / skill_list / skill_delete。owner-only。
// builtin skills 不可删 (usecase 拦)。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capSkillsBundle = "skills.bundle"

type skillsCapability struct {
	skills *usecases.SkillsDeps
	log    *slog.Logger
}

func newSkillsCapability(
	skills *usecases.SkillsDeps, log *slog.Logger,
) *skillsCapability {
	return &skillsCapability{skills: skills, log: log}
}

func (*skillsCapability) ID() string          { return capSkillsBundle }
func (*skillsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*skillsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*skillsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*skillsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *skillsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.createBinding(), c.listBinding(), c.deleteBinding(),
		c.setEnabledBinding(),
	}
}

// ───── skill_create ─────────────────────────────────────────────

func (c *skillsCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "skill_create",
		Description: "Create an owner-curated AI skill (extra system prompt + optional " +
			"sandbox scripts). Attach to invite codes to compose the visitor-facing " +
			"AI persona + capability set.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"name":{"type":"string","description":"Skill name, unique per owner."},
				"prompt":{"type":"string",
					"description":"System prompt fragment appended to base persona."},
				"description":{"type":"string",
					"description":"Optional one-line description."},
				"allowed_tools":{"type":"array","items":{"type":"string"},
					"description":"Capability IDs unlocked on roles (e.g. calendar.book)."},
				"scripts":{"type":"array","items":{"type":"object"},
					"description":"Optional sandbox scripts; each {filename,language,content,...}."}
			},
			"required":["name","prompt"]
		}`),
		Handler: c.handleCreate,
	}
}

type skillCreateArgsWire struct {
	Name         string                    `json:"name"`
	Prompt       string                    `json:"prompt"`
	Description  string                    `json:"description"`
	AllowedTools []string                  `json:"allowed_tools"`
	Scripts      []marketplace.SkillScript `json:"scripts"`
}

func (c *skillsCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseSkillCreateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	skill, cerr := usecases.CreateSkill(ctx, *c.skills, &usecases.CreateSkillInput{
		OwnerID: ownerID, Name: args.Name, Prompt: args.Prompt,
		Description: args.Description, AllowedTools: args.AllowedTools, Scripts: args.Scripts,
	})
	if cerr != nil {
		if errors.Is(cerr, marketplace.ErrSkillNameTaken) {
			return capreg.MCPError("skill name already taken")
		}
		c.log.Error("cap skill_create", "err", cerr)
		return capreg.MCPError("create skill failed")
	}
	return mcputil.MarshalResult(c.log, "skill_create", map[string]string{
		"skill_id": skill.ID, "name": skill.Name,
	})
}

func parseSkillCreateArgs(raw json.RawMessage) (skillCreateArgsWire, error) {
	var args skillCreateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Name == "" {
		return args, errors.New("name is required")
	}
	if args.Prompt == "" {
		return args, errors.New("prompt is required")
	}
	if args.Scripts == nil {
		args.Scripts = []marketplace.SkillScript{}
	}
	return args, nil
}

// ───── skill_list ──────────────────────────────────────────────

func (c *skillsCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "skill_list",
		Description: "List all skills (builtin first, then owner-curated, by name).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type skillListRow struct {
	CreatedAt   string `json:"created_at"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
	Source      string `json:"source"`
	IsBuiltin   bool   `json:"is_builtin"`
}

func (c *skillsCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	rows, err := usecases.ListSkills(ctx, *c.skills, ownerID)
	if err != nil {
		c.log.Error("cap skill_list", "err", err)
		return capreg.MCPError("list skills failed")
	}
	out := make([]skillListRow, 0, len(rows))
	for i := range rows {
		out = append(out, skillListRow{
			ID: rows[i].ID, Name: rows[i].Name,
			Description: rows[i].Description, Prompt: rows[i].Prompt,
			Source: rows[i].Source, IsBuiltin: rows[i].IsBuiltin,
			CreatedAt: rows[i].CreatedAt.Format(mcpTimeFmt),
		})
	}
	return mcputil.MarshalResult(c.log, "skill_list", out)
}

// ───── skill_delete ───────────────────────────────────────────

func (c *skillsCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "skill_delete",
		Description: "Delete an owner-curated skill. Builtin skills cannot be deleted.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"skill_id":{"type":"string","description":"Skill id"}
			},
			"required":["skill_id"]
		}`),
		Handler: c.handleDelete,
	}
}

type skillDeleteArgsWire struct {
	SkillID string `json:"skill_id"`
}

func (c *skillsCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args skillDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.SkillID == "" {
		return capreg.MCPError("skill_id is required")
	}
	if err := usecases.DeleteSkill(ctx, *c.skills, ownerID, args.SkillID); err != nil {
		return skillDeleteErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "skill_delete", map[string]string{
		"skill_id": args.SkillID,
	})
}

func skillDeleteErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, marketplace.ErrSkillBuiltinImmutable) {
		return capreg.MCPError("builtin skill cannot be deleted")
	}
	if errors.Is(err, marketplace.ErrSkillNotFound) {
		return capreg.MCPError("skill not found")
	}
	log.Error("cap skill_delete", "err", err)
	return capreg.MCPError("delete skill failed")
}

// ───── skill_set_enabled ───────────────────────────────────────

func (c *skillsCapability) setEnabledBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "skill_set_enabled",
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
		Handler: c.handleSetEnabled,
	}
}

type skillSetEnabledArgsWire struct {
	SkillID string `json:"skill_id"`
	Enabled bool   `json:"enabled"`
}

func (c *skillsCapability) handleSetEnabled(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args skillSetEnabledArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.SkillID == "" {
		return capreg.MCPError("skill_id is required")
	}
	skill, err := usecases.SetSkillEnabled(ctx, *c.skills, ownerID, args.SkillID, args.Enabled)
	if err != nil {
		if errors.Is(err, marketplace.ErrSkillNotFound) {
			return capreg.MCPError("skill not found")
		}
		c.log.Error("cap skill_set_enabled", "err", err)
		return capreg.MCPError("set skill enabled failed")
	}
	return mcputil.MarshalResult(c.log, "skill_set_enabled", map[string]any{
		"skill_id": skill.ID, "name": skill.Name, "enabled": skill.Enabled,
	})
}
