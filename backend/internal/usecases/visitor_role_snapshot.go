// visitor_role_snapshot.go —— session issue 时把 Role 状态拍下来塞 session_data。
//
// 设计 [[iam-role-pivot-plan]] · Session freeze 节。code.AssumedRoleID == nil
// 走 legacy 路径（caller 不调本 helper，session 里 RoleSnapshot 留 nil）。
// 持 assumed_role_id 时：load role + prompt + skills → wrap RoleSnapshot。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

// buildRoleSnapshotForCode —— code 持 assumed_role_id 时构造 RoleSnapshot。
// caller 已确认 code.AssumedRoleID != nil（在 loadCodeSessionBundle dispatch
// 时检查），所以本函数不再返 (nil, nil) ——失败永远是真 error。
func buildRoleSnapshotForCode(
	ctx context.Context, deps *VisitorDeps, code *domain.AccessCode,
) (domain.RoleSnapshot, error) {
	role, err := deps.Roles.GetByID(ctx, code.OwnerID, *code.AssumedRoleID)
	if err != nil {
		return domain.RoleSnapshot{}, fmt.Errorf("get role for snapshot: %w", err)
	}
	promptBody, err := loadPromptBody(ctx, deps, code.OwnerID, &role)
	if err != nil {
		return domain.RoleSnapshot{}, err
	}
	skills, err := loadRoleSkills(ctx, deps, role.ID())
	if err != nil {
		return domain.RoleSnapshot{}, err
	}
	return domain.NewRoleSnapshot(&domain.RoleSnapshotInit{
		FrozenAt:     time.Now(),
		RoleID:       role.ID(),
		RoleName:     role.Name(),
		PromptBody:   promptBody,
		CorpusURIs:   role.CorpusURIs(),
		SkillPrompts: skills.Prompts,
		AllowedTools: skills.Tools,
		SkillIDs:     role.SkillIDs(),
		MCPServerIDs: role.MCPServerIDs(),
	}), nil
}

// loadPromptBody —— role 没挂 prompt 或挂的 prompt 不存在 → 返空串（vanilla
// 之类 role 不一定有 prompt，session 没问题）。
func loadPromptBody(
	ctx context.Context, deps *VisitorDeps, ownerID string, role *domain.Role,
) (string, error) {
	promptID, ok := role.PromptID()
	if !ok {
		return "", nil
	}
	prompt, err := deps.Prompts.GetByID(ctx, ownerID, promptID)
	if err != nil {
		if errors.Is(err, domain.ErrPromptNotFound) {
			return "", nil
		}
		return "", fmt.Errorf("get prompt for snapshot: %w", err)
	}
	return prompt.Body(), nil
}

// roleSkillBundle —— loadRoleSkills 返回打包，避开 function-result-limit 3-return。
type roleSkillBundle struct {
	Prompts []string
	Tools   []string
}

// loadRoleSkills —— 把 role 挂的 skills 的 prompt 拼一组、allowed_tools 合并
// 去重一组。
func loadRoleSkills(
	ctx context.Context, deps *VisitorDeps, roleID string,
) (roleSkillBundle, error) {
	skills, lerr := deps.Skills.ListSkillsForRole(ctx, roleID)
	if lerr != nil {
		return roleSkillBundle{}, fmt.Errorf("list role skills: %w", lerr)
	}
	return collectRoleSkillBundle(skills), nil
}

// collectRoleSkillBundle —— skills → (prompts, deduped allowed_tools)。提
// 出来降 loadRoleSkills 的 cyclo。
func collectRoleSkillBundle(skills []domain.Skill) roleSkillBundle {
	prompts := make([]string, 0, len(skills))
	toolSet := make(map[string]struct{}, len(skills)*2)
	for i := range skills {
		if p := strings.TrimSpace(skills[i].Prompt); p != "" {
			prompts = append(prompts, p)
		}
		for _, t := range skills[i].AllowedTools {
			toolSet[t] = struct{}{}
		}
	}
	tools := make([]string, 0, len(toolSet))
	for t := range toolSet {
		tools = append(tools, t)
	}
	return roleSkillBundle{Prompts: prompts, Tools: tools}
}
