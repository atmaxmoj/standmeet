// visitor_role_snapshot.go —— session issue 时把 Role 状态拍下来塞 session_data。
//
// 设计 [[iam-role-pivot-plan]] · Session freeze 节。A.3-IAM-5 起 access_code
// 必挂 assumed_role_id（NOT NULL）；public / byoai 则用 owner 的 vanilla。
// Snapshot 从 role + prompt + skills 拼起来；session 整个生命周期不再回头读。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// buildRoleSnapshotForCode —— code.AssumedRoleID 必填（schema NOT NULL）→ 构造
// RoleSnapshot。失败永远是真 error。
func buildRoleSnapshotForCode(
	ctx context.Context, deps *VisitorSessionDeps, code *domain.AccessCode,
) (domain.RoleSnapshot, error) {
	denials, err := loadCodeDenials(ctx, deps, code.ID)
	if err != nil {
		return domain.RoleSnapshot{}, err
	}
	return buildRoleSnapshotByID(ctx, deps, code.OwnerID, code.AssumedRoleID, denials)
}

// roleDenials —— code 层要从 role grant 里砍掉的 capability / skill id（纯 deny）。
// 非 code 路径（vanilla/public）传零值 = 不砍。
type roleDenials struct {
	Caps   []string
	Skills []string
}

// loadCodeDenials —— 读一张 code 的 deny 集。无 CodeDenials port（eval facade /
// 老路径没接）→ 零 deny，行为同从前（向后兼容）。
func loadCodeDenials(
	ctx context.Context, deps *VisitorSessionDeps, codeID string,
) (roleDenials, error) {
	if deps.CodeDenials == nil {
		return roleDenials{}, nil
	}
	caps, err := deps.CodeDenials.ListCapabilities(ctx, codeID)
	if err != nil {
		return roleDenials{}, fmt.Errorf("list code capability denials: %w", err)
	}
	skills, err := deps.CodeDenials.ListSkills(ctx, codeID)
	if err != nil {
		return roleDenials{}, fmt.Errorf("list code skill denials: %w", err)
	}
	return roleDenials{Caps: caps, Skills: skills}, nil
}

// buildRoleSnapshotForOwnerVanilla —— public / byoai session 用 owner 的
// vanilla role snapshot。owner 没改过 vanilla 的话覆盖 wiki/output/writing
// 三个公开 glob。
func buildRoleSnapshotForOwnerVanilla(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string,
) (domain.RoleSnapshot, error) {
	role, err := deps.Roles.GetByName(ctx, ownerID, domain.VanillaRoleName)
	if err != nil {
		return domain.RoleSnapshot{}, fmt.Errorf("get vanilla role: %w", err)
	}
	return buildRoleSnapshotByID(ctx, deps, ownerID, role.ID(), roleDenials{})
}

func buildRoleSnapshotByID(
	ctx context.Context, deps *VisitorSessionDeps, ownerID, roleID string, denials roleDenials,
) (domain.RoleSnapshot, error) {
	role, err := deps.Roles.GetByID(ctx, ownerID, roleID)
	if err != nil {
		return domain.RoleSnapshot{}, fmt.Errorf("get role for snapshot: %w", err)
	}
	promptBody, err := loadPromptBody(ctx, deps, ownerID, &role)
	if err != nil {
		return domain.RoleSnapshot{}, err
	}
	// ACL code 层（capability-acl-hierarchy.md）：deny 的 skill 在装配源头就剔除，
	// 这样它的 L1 prompt / tool 授权 / id 一并消失（只减 SkillIDs 漏掉了 L1 prompt）。
	skills, err := loadRoleSkills(ctx, deps, role.ID(), denials.Skills)
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
		// capability deny 冻进 DeniedCapabilities，能力暴露门据此挡掉（含 ACL=always
		// 的——它们不进 allowedTools，subtract 减不到，只能在门上挡）。
		DeniedCapabilities: denials.Caps,
		// Phase C: 只冻 enabled 授权 skill 的 id（bundle 已过 enabled），让
		// disabled skill 既不进 L1，也不被 skill_use/skill_run_script 命中。
		SkillIDs:     skills.IDs,
		MCPServerIDs: role.MCPServerIDs(),
	}), nil
}

// loadPromptBody —— role 没挂 prompt 或挂的 prompt 不存在 → 返空串（vanilla
// 之类 role 不一定有 prompt，session 没问题）。
func loadPromptBody(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, role *domain.Role,
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
	Prompts []string // Phase C / L1: 每条 = skill 的 name+description（不是正文）
	Tools   []string
	IDs     []string // enabled 授权 skill 的 id（snapshot.SkillIDs → skill_use/run）
}

// loadRoleSkills —— 把 role 挂的 skills 的 prompt 拼一组、allowed_tools 合并
// 去重一组。
func loadRoleSkills(
	ctx context.Context, deps *VisitorSessionDeps, roleID string, deniedSkills []string,
) (roleSkillBundle, error) {
	skills, lerr := deps.Skills.ListSkillsForRole(ctx, roleID)
	if lerr != nil {
		return roleSkillBundle{}, fmt.Errorf("list role skills: %w", lerr)
	}
	return collectRoleSkillBundle(filterDeniedSkills(skills, deniedSkills)), nil
}

// filterDeniedSkills —— ACL code 层：剔掉这张 code deny 的 skill（按 id）。源头剔除
// 让 prompt / tool / id 一致消失。空 deny → 原样返回。
func filterDeniedSkills(skills []domain.Skill, denied []string) []domain.Skill {
	if len(denied) == 0 {
		return skills
	}
	out := make([]domain.Skill, 0, len(skills))
	for i := range skills {
		if !slices.Contains(denied, skills[i].ID) {
			out = append(out, skills[i])
		}
	}
	return out
}

// collectRoleSkillBundle —— ListSkillsForRole 已按 enabled 过滤。Phase C：
// 系统提示只放 name+description（L1 progressive disclosure），正文要 agent 调
// skill_use 才披露（L2）；同时收 enabled skill id 冻进 snapshot，让 binding 只
// 对 enabled 授权 skill 暴露 skill_use/skill_run_script。
func collectRoleSkillBundle(skills []domain.Skill) roleSkillBundle {
	prompts := make([]string, 0, len(skills))
	ids := make([]string, 0, len(skills))
	toolSet := make(map[string]struct{}, len(skills)*2)
	for i := range skills {
		ids = append(ids, skills[i].ID)
		if line := skillL1Line(&skills[i]); line != "" {
			prompts = append(prompts, line)
		}
		for _, t := range skills[i].AllowedTools {
			toolSet[t] = struct{}{}
		}
	}
	tools := make([]string, 0, len(toolSet))
	for t := range toolSet {
		tools = append(tools, t)
	}
	return roleSkillBundle{Prompts: prompts, Tools: tools, IDs: ids}
}

// skillL1Line —— L1 注入系统提示的一行:name + 一句话 description + 提示用
// skill_use 读正文。引导 agent 在相关时才把正文（L2）拉进上下文。
func skillL1Line(s *domain.Skill) string {
	name := strings.TrimSpace(s.Name)
	if name == "" {
		return ""
	}
	line := fmt.Sprintf("skill %q", name)
	if d := strings.TrimSpace(s.Description); d != "" {
		line += ": " + d
	}
	return line + fmt.Sprintf(" (call skill_use(name=%q) to read its instructions)", name)
}
