// skills.go —— owner-curated AI Skills CRUD。
//
// Skill = 一段附加 system prompt（+ 未来 sandbox 脚本）。owner 通过 admin /
// MCP CRUD；InviteCode 通过 code_skills 选若干个；visitor session 颁发时把
// 选中 skill.prompt 列表固化到 session（[[skill]] domain type）。
//
// builtin skill 在 owner 首次 claim 时 seed，is_builtin=true，不可删（repo
// DeleteSkill 加了 is_builtin=false 谓词）。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// SkillsDeps —— skills CRUD 需要的 repo 集合。Code 用来 SetCodeSkills 时
// 校验 code 属于同 owner。
type SkillsDeps struct {
	Skills *postgres.SkillRepo
	Codes  *postgres.CodeRepo
}

// CreateSkillInput —— skill.create 入参。
type CreateSkillInput struct {
	OwnerID      string
	Name         string
	Description  string
	Prompt       string
	AllowedTools []string
}

// CreateSkill 新建 owner-curated skill。
func CreateSkill(
	ctx context.Context, deps SkillsDeps, in *CreateSkillInput,
) (domain.Skill, error) {
	if in.OwnerID == "" || in.Name == "" {
		return domain.Skill{}, ErrEmptyField
	}
	skill, err := deps.Skills.Create(ctx, &postgres.CreateSkillInput{
		OwnerID:      in.OwnerID,
		Name:         in.Name,
		Description:  in.Description,
		Prompt:       in.Prompt,
		AllowedTools: in.AllowedTools,
	})
	if err != nil {
		if errors.Is(err, domain.ErrSkillNameTaken) {
			return domain.Skill{}, domain.ErrSkillNameTaken
		}
		return domain.Skill{}, fmt.Errorf("create skill: %w", err)
	}
	return skill, nil
}

// ListSkills —— admin / MCP skill.list。
func ListSkills(
	ctx context.Context, deps SkillsDeps, ownerID string,
) ([]domain.Skill, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	rows, err := deps.Skills.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	return rows, nil
}

// DeleteSkill —— admin / MCP skill.delete。builtin skill 删不掉（repo 加
// is_builtin=false 谓词 → 命中 0 行，但当前返 nil；调用方先 GetByID 校验）。
func DeleteSkill(
	ctx context.Context, deps SkillsDeps, ownerID, skillID string,
) error {
	if ownerID == "" || skillID == "" {
		return ErrEmptyField
	}
	if cerr := checkSkillDeletable(ctx, deps, ownerID, skillID); cerr != nil {
		return cerr
	}
	if err := deps.Skills.Delete(ctx, ownerID, skillID); err != nil {
		return fmt.Errorf("delete skill: %w", err)
	}
	return nil
}

func checkSkillDeletable(
	ctx context.Context, deps SkillsDeps, ownerID, skillID string,
) error {
	skill, gerr := deps.Skills.GetByID(ctx, ownerID, skillID)
	if gerr != nil {
		return fmt.Errorf("get skill: %w", gerr)
	}
	if skill.IsBuiltin {
		return domain.ErrSkillBuiltinImmutable
	}
	return nil
}

// SetCodeSkillsInput —— admin code 编辑时设置该 code 的 skill 集合。
type SetCodeSkillsInput struct {
	OwnerID  string
	CodeID   string
	SkillIDs []string
}

// SetCodeSkills —— 校验 code 属于 owner、每个 skill 属于 owner，然后
// repo.SetCodeSkills(clear + bulk insert)。
func SetCodeSkills(
	ctx context.Context, deps SkillsDeps, in *SetCodeSkillsInput,
) error {
	if in.OwnerID == "" || in.CodeID == "" {
		return ErrEmptyField
	}
	if verr := validateSetCodeSkillsInput(ctx, deps, in); verr != nil {
		return verr
	}
	if serr := deps.Skills.SetCodeSkills(ctx, in.CodeID, in.SkillIDs); serr != nil {
		return fmt.Errorf("set code skills: %w", serr)
	}
	return nil
}

func validateSetCodeSkillsInput(
	ctx context.Context, deps SkillsDeps, in *SetCodeSkillsInput,
) error {
	if verr := validateCodeOwnership(ctx, deps, in); verr != nil {
		return verr
	}
	return validateSkillsOwnership(ctx, deps, in)
}

func validateCodeOwnership(
	ctx context.Context, deps SkillsDeps, in *SetCodeSkillsInput,
) error {
	code, err := deps.Codes.GetByID(ctx, in.CodeID)
	if err != nil {
		return fmt.Errorf("get code: %w", err)
	}
	if code.OwnerID != in.OwnerID {
		return domain.ErrCodeInvalid
	}
	return nil
}

func validateSkillsOwnership(
	ctx context.Context, deps SkillsDeps, in *SetCodeSkillsInput,
) error {
	for _, sid := range in.SkillIDs {
		if _, gerr := deps.Skills.GetByID(ctx, in.OwnerID, sid); gerr != nil {
			return fmt.Errorf("validate skill %s: %w", sid, gerr)
		}
	}
	return nil
}
