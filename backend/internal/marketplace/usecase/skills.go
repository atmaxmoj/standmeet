// skills.go —— owner-curated AI Skills CRUD。
//
// Skill = a chunk of appended system prompt (+ a future sandbox script). The owner creates
// them via admin / MCP CRUD; InviteCode selects some through code_skills; when a visitor
// session is issued, the selected skill.prompt list is frozen into the session ([[skill]]
// domain type).
//
// builtin skills are seeded on the owner's first claim, is_builtin=true, and can't be
// deleted (the repo's DeleteSkill adds an is_builtin=false predicate).

package usecase

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/repo"
)

// SkillsDeps —— the repo bundle skills CRUD needs. Code is used to validate that a code
// belongs to the same owner when SetCodeSkills runs.
type SkillsDeps struct {
	Skills *repo.SkillRepo
	Codes  *access.CodeRepo
}

// CreateSkillReq —— skill.create input.
type CreateSkillReq struct {
	OwnerID      string
	Name         string
	Description  string
	Prompt       string
	AllowedTools []string
	Scripts      []entity.SkillScript
}

// CreateSkill creates a new owner-curated skill.
func CreateSkill(
	ctx context.Context, deps SkillsDeps, in *CreateSkillReq,
) (entity.Skill, error) {
	if in.OwnerID == "" || in.Name == "" {
		return entity.Skill{}, apierr.ErrEmptyField
	}
	skill, err := deps.Skills.Create(ctx, &repo.CreateSkillInput{
		OwnerID:      in.OwnerID,
		Name:         in.Name,
		Description:  in.Description,
		Prompt:       in.Prompt,
		AllowedTools: in.AllowedTools,
		Scripts:      in.Scripts,
	})
	if err != nil {
		if errors.Is(err, entity.ErrSkillNameTaken) {
			return entity.Skill{}, entity.ErrSkillNameTaken
		}
		return entity.Skill{}, fmt.Errorf("create skill: %w", err)
	}
	return skill, nil
}

// UpdateSkillReq —— skill.update input.
type UpdateSkillReq struct {
	OwnerID      string
	SkillID      string
	Name         string
	Description  string
	Prompt       string
	AllowedTools []string
}

// UpdateSkill —— edit one of the owner's own skills: its body, and **which tools it can
// call**.
//
// The latter is the only place the owner can grant a connector operation: the session's
// tool gate checks "does the allowed_tools of the skills attached to this role contain
// `op_<id>`", and the role itself carries no tool list of its own. This path used to be
// reachable only through marketplace import and owner-MCP — the GUI had no entry point at
// all (F-C-57).
func UpdateSkill(
	ctx context.Context, deps SkillsDeps, in *UpdateSkillReq,
) (entity.Skill, error) {
	if in.OwnerID == "" || in.SkillID == "" || in.Name == "" {
		return entity.Skill{}, apierr.ErrEmptyField
	}
	skill, err := deps.Skills.Update(ctx, &repo.UpdateSkillInput{
		OwnerID: in.OwnerID, SkillID: in.SkillID, Name: in.Name,
		Description: in.Description, Prompt: in.Prompt, AllowedTools: in.AllowedTools,
	})
	if err != nil {
		// Always wrap it, but with %w — the sentinel still passes through, so the table
		// upstream that maps errors.Is to copy (ops/skills.go's skillErrClasses) doesn't
		// need a single character changed.
		return entity.Skill{}, fmt.Errorf("update skill: %w", err)
	}
	return skill, nil
}

// ListSkills —— admin / MCP skill.list。
func ListSkills(
	ctx context.Context, deps SkillsDeps, ownerID string,
) ([]entity.Skill, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Skills.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	return rows, nil
}

// DeleteSkill —— admin / MCP skill.delete. A builtin skill can't be deleted (the repo adds
// an is_builtin=false predicate → 0 rows hit, but currently returns nil; the caller
// validates via GetByID first).
func DeleteSkill(
	ctx context.Context, deps SkillsDeps, ownerID, skillID string,
) error {
	if ownerID == "" || skillID == "" {
		return apierr.ErrEmptyField
	}
	if cerr := checkSkillDeletable(ctx, deps, ownerID, skillID); cerr != nil {
		return cerr
	}
	if err := deps.Skills.Delete(ctx, ownerID, skillID); err != nil {
		return fmt.Errorf("delete skill: %w", err)
	}
	return nil
}

// SetSkillEnabled —— #48-2: the owner globally enables/disables one skill (builtin skills
// can be toggled too, they just can't be deleted).
func SetSkillEnabled(
	ctx context.Context, deps SkillsDeps, ownerID, skillID string, enabled bool,
) (entity.Skill, error) {
	if ownerID == "" || skillID == "" {
		return entity.Skill{}, apierr.ErrEmptyField
	}
	out, err := deps.Skills.SetEnabled(ctx, ownerID, skillID, enabled)
	if err != nil {
		return entity.Skill{}, fmt.Errorf("set skill enabled: %w", err)
	}
	return out, nil
}

func checkSkillDeletable(
	ctx context.Context, deps SkillsDeps, ownerID, skillID string,
) error {
	skill, gerr := deps.Skills.GetByID(ctx, ownerID, skillID)
	if gerr != nil {
		return fmt.Errorf("get skill: %w", gerr)
	}
	if skill.IsBuiltin {
		return entity.ErrSkillBuiltinImmutable
	}
	return nil
}

// A.3-IAM-5: SetCodeSkillsInput / SetCodeSkills and friends are all gone — skills now
// attach via role_skills on the Role, a code no longer holds skill_ids directly.
