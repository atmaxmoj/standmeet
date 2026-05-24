// tools_skills.go —— skill.create / skill.list / skill.delete MCP tools。
//
// 设计源自 legacy gateway/src/runtime/skill-tools.ts —— owner 在自己的 AI
// 客户端里 curate skill prompts；这里只暴露最小 CRUD（不含 update —— update =
// delete + create 在 owner-facing UX 里更明确）。

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

func skillsTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(skillCreateTool(), wrapTool(invokeSkillCreate(deps)))
	srv.AddTool(skillListTool(), wrapTool(invokeSkillList(deps)))
	srv.AddTool(skillDeleteTool(), wrapTool(invokeSkillDelete(deps)))
}

func skillCreateTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"skill_create",
		mcpgo.WithDescription("Create an owner-curated AI skill (extra system prompt). "+
			"Attach it to invite codes to compose the visitor-facing AI persona."),
		mcpgo.WithString("name", mcpgo.Required(),
			mcpgo.Description("Skill name, unique per owner (e.g. 'code-review').")),
		mcpgo.WithString("prompt", mcpgo.Required(),
			mcpgo.Description("System prompt fragment appended to base persona.")),
		mcpgo.WithString("description",
			mcpgo.Description("Optional one-line description of what the skill does.")),
	)
}

func invokeSkillCreate(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		in, perr := parseSkillCreateParams(req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		return runSkillCreate(ctx, deps, in)
	}
}

func parseSkillCreateParams(
	req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.CreateSkillInput, error) {
	name, err := req.RequireString("name")
	if err != nil {
		return nil, errors.New("name is required")
	}
	prompt, err := req.RequireString("prompt")
	if err != nil {
		return nil, errors.New("prompt is required")
	}
	return &usecases.CreateSkillInput{
		OwnerID: ownerID, Name: name, Prompt: prompt,
		Description: req.GetString("description", ""),
	}, nil
}

func runSkillCreate(
	ctx context.Context, deps *Deps, in *usecases.CreateSkillInput,
) *mcpgo.CallToolResult {
	skill, cerr := usecases.CreateSkill(ctx, deps.Skills, in)
	if cerr != nil {
		if errors.Is(cerr, domain.ErrSkillNameTaken) {
			return mcpgo.NewToolResultError("skill name already taken")
		}
		deps.Log.Error("mcp skill_create", "err", cerr)
		return mcpgo.NewToolResultError("create skill failed")
	}
	return marshalResult(deps, skillIDPayload{SkillID: skill.ID, Name: skill.Name})
}

func skillListTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"skill_list",
		mcpgo.WithDescription("List all skills (builtin first, then owner-curated, by name)."),
	)
}

func invokeSkillList(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		rows, err := usecases.ListSkills(ctx, deps.Skills, ownerID)
		if err != nil {
			deps.Log.Error("mcp skill_list", "err", err)
			return mcpgo.NewToolResultError("list skills failed")
		}
		return marshalResult(deps, skillListView(rows))
	}
}

func skillDeleteTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"skill_delete",
		mcpgo.WithDescription("Delete an owner-curated skill. Builtin skills cannot be deleted."),
		mcpgo.WithString("skill_id", mcpgo.Required(),
			mcpgo.Description("Skill id returned by skill_create / skill_list.")),
	)
}

func invokeSkillDelete(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		skillID, err := req.RequireString("skill_id")
		if err != nil {
			return mcpgo.NewToolResultError("skill_id is required")
		}
		return runSkillDelete(ctx, deps, ownerID, skillID)
	}
}

func runSkillDelete(
	ctx context.Context, deps *Deps, ownerID, skillID string,
) *mcpgo.CallToolResult {
	derr := usecases.DeleteSkill(ctx, deps.Skills, ownerID, skillID)
	if derr == nil {
		return marshalResult(deps, skillIDPayload{SkillID: skillID})
	}
	return translateSkillDeleteErr(deps, derr)
}

func translateSkillDeleteErr(deps *Deps, derr error) *mcpgo.CallToolResult {
	switch {
	case errors.Is(derr, domain.ErrSkillBuiltinImmutable):
		return mcpgo.NewToolResultError("builtin skill cannot be deleted")
	case errors.Is(derr, domain.ErrSkillNotFound):
		return mcpgo.NewToolResultError("skill not found")
	}
	deps.Log.Error("mcp skill_delete", "err", derr)
	return mcpgo.NewToolResultError("delete skill failed")
}

// ---- payload ----------------------------------------------------------

type skillIDPayload struct {
	SkillID string `json:"skill_id"`
	Name    string `json:"name,omitempty"`
}

func (p skillIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal skill id payload: %w", err)
	}
	return b, nil
}

type skillView struct {
	CreatedAt   string `json:"created_at"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
	Source      string `json:"source"`
	IsBuiltin   bool   `json:"is_builtin"`
}

func skillListView(rows []domain.Skill) skillListPayload {
	out := make(skillListPayload, 0, len(rows))
	for i := range rows {
		out = append(out, skillView{
			ID:          rows[i].ID,
			Name:        rows[i].Name,
			Description: rows[i].Description,
			Prompt:      rows[i].Prompt,
			Source:      rows[i].Source,
			IsBuiltin:   rows[i].IsBuiltin,
			CreatedAt:   rows[i].CreatedAt.Format(mcpTimeFmt),
		})
	}
	return out
}

type skillListPayload []skillView

func (p skillListPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal skill list payload: %w", err)
	}
	return b, nil
}
