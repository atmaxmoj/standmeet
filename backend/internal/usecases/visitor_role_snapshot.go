// visitor_role_snapshot.go —— session issue 时把 Role 状态拍下来塞 session_data。
//
// 设计 [[iam-role-pivot-plan]] · Session freeze 节。A.3-IAM-5 起 access_code
// 必挂 assumed_role_id（NOT NULL）；public / byoai 则用 owner 的 public。
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
	// #104(+扩展): code 自带的 prompt 冻进 snapshot，persona 在 role persona 之后叠加。
	// 内联 prompt（发码方随码带，不查库，如 job-loop 的 recruiter 应聘身份）**优先**；空则走
	// prompt_id 库引用（owner 集中管理那份）。都没 → 空串（persona 逐字不变）。
	codePrompt, perr := resolveCodePrompt(ctx, deps, code)
	if perr != nil {
		return domain.RoleSnapshot{}, perr
	}
	// ghost-steering: 这张 code 的 waypoint 覆盖层(空 = 完全继承 role 的)。
	wps, werr := loadCodeWaypoints(ctx, deps, code.ID)
	if werr != nil {
		return domain.RoleSnapshot{}, werr
	}
	return buildRoleSnapshotByID(ctx, deps, code.OwnerID, code.AssumedRoleID,
		&codeOverlay{
			denials: denials, codePromptBody: codePrompt, waypoints: wps,
			requireGhostEvidence: code.RequireGhostEvidence,
		})
}

// loadCodeWaypoints —— 读一张 code 的 waypoint 覆盖层。无 Codes port(eval facade / 老路径没接)
// → 空覆盖,行为同从前(完全继承 role,向后兼容)。
func loadCodeWaypoints(
	ctx context.Context, deps *VisitorSessionDeps, codeID string,
) ([]domain.Waypoint, error) {
	if deps.Codes == nil {
		return []domain.Waypoint{}, nil
	}
	wps, err := deps.Codes.Waypoints(ctx, codeID)
	if err != nil {
		return []domain.Waypoint{}, fmt.Errorf("list code waypoints: %w", err)
	}
	return wps, nil
}

// resolveCodePrompt —— #104 扩展的取值：内联 per-code prompt 优先（发码方随码带，不查库），
// 空则走 prompt_id 库引用（owner 集中管理那份）。
func resolveCodePrompt(
	ctx context.Context, deps *VisitorSessionDeps, code *domain.AccessCode,
) (string, error) {
	if code.InlinePrompt != "" {
		return code.InlinePrompt, nil
	}
	return promptBodyByID(ctx, deps, code.OwnerID, code.PromptID)
}

// roleDenials —— code 层要从 role grant 里砍掉的 capability / skill id（纯 deny）。
// 非 code 路径（public + byoai）传零值 = 不砍。
type roleDenials struct {
	Caps   []string
	Skills []string
	// Corpus —— 这张 code 从 role 的正列表里收回的 URI glob（ACL 三类里的 corpus 那类）。
	// 不从 CorpusURIs 里删：glob 减法删不掉列表项，冻成独立一列，匹配时判（AllowsCorpusScope）。
	Corpus []string
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
	uris, uerr := deps.CodeDenials.ListCorpusURIs(ctx, codeID)
	if uerr != nil {
		return roleDenials{}, fmt.Errorf("list code corpus denials: %w", uerr)
	}
	return roleDenials{Caps: caps, Skills: skills, Corpus: uris}, nil
}

// APIKeyDenialReader —— read an API key's deny set (postgres.APIKeyRepo implements it). Same shape
// as the code denial reader; the api facade subtracts these from the assumed role's grant.
type APIKeyDenialReader interface {
	ListCapabilityDenials(ctx context.Context, keyID string) ([]string, error)
	ListSkillDenials(ctx context.Context, keyID string) ([]string, error)
}

// BuildAPIKeyRoleSnapshot —— freeze the RoleSnapshot for an API key: the assumed role's grant minus
// the key's per-key denials. No per-key prompt (the api facade has no LLM persona) — snapshot is
// used purely to gate which capabilities/tools the key's HTTP calls may reach.
func BuildAPIKeyRoleSnapshot(
	ctx context.Context, deps *VisitorSessionDeps, denials APIKeyDenialReader, key *domain.APIKey,
) (domain.RoleSnapshot, error) {
	caps, err := denials.ListCapabilityDenials(ctx, key.ID)
	if err != nil {
		return domain.RoleSnapshot{}, fmt.Errorf("list api key capability denials: %w", err)
	}
	skills, serr := denials.ListSkillDenials(ctx, key.ID)
	if serr != nil {
		return domain.RoleSnapshot{}, fmt.Errorf("list api key skill denials: %w", serr)
	}
	return buildRoleSnapshotByID(ctx, deps, key.OwnerID, key.AssumedRoleID,
		&codeOverlay{denials: roleDenials{Caps: caps, Skills: skills}})
}

// buildRoleSnapshotForOwnerPublic —— public / byoai session 用 owner 的
// public role snapshot。owner 没改过 public 的话覆盖 wiki/output/writing
// 三个公开 glob。
func buildRoleSnapshotForOwnerPublic(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string,
) (domain.RoleSnapshot, error) {
	role, err := deps.Roles.GetByName(ctx, ownerID, domain.PublicRoleName)
	if err != nil {
		return domain.RoleSnapshot{}, fmt.Errorf("get public role: %w", err)
	}
	// public + byoai (非 code 路径) 无 per-code prompt、无 deny。
	return buildRoleSnapshotByID(ctx, deps, ownerID, role.ID(), &codeOverlay{})
}

// codeOverlay —— code 层在 role 基础上的叠加：deny 集 + 这张 code 自带的 prompt body。
// 非 code 路径（public + byoai）传零值 = 不 deny、无 per-code prompt。
type codeOverlay struct {
	codePromptBody string
	denials        roleDenials
	// requireGhostEvidence —— F-A-10 per-code 覆盖（nil = 继承 role 的开关）。
	requireGhostEvidence *bool
	// waypoints —— 这张 code 的 ghost-steering 覆盖层（空 = 完全继承 role 的）。放末位:slice 尾部
	// len/cap 无指针,让 GC 少扫 16 字节（fieldalignment）。
	waypoints []domain.Waypoint
}

func buildRoleSnapshotByID(
	ctx context.Context, deps *VisitorSessionDeps, ownerID, roleID string, overlay *codeOverlay,
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
	skills, err := loadRoleSkills(ctx, deps, role.ID(), overlay.denials.Skills)
	if err != nil {
		return domain.RoleSnapshot{}, err
	}
	return domain.NewRoleSnapshot(&domain.RoleSnapshotInit{
		FrozenAt:       time.Now(),
		RoleID:         role.ID(),
		RoleName:       role.Name(),
		PromptBody:     promptBody,
		CodePromptBody: overlay.codePromptBody,
		CorpusURIs:     role.CorpusURIs(),
		SkillPrompts:   skills.Prompts,
		AllowedTools:   skills.Tools,
		// capability deny 冻进 DeniedCapabilities，能力暴露门据此挡掉（含 ACL=always
		// 的——它们不进 allowedTools，subtract 减不到，只能在门上挡）。
		DeniedCapabilities: overlay.denials.Caps,
		// corpus 的 code 层收窄：冻成独立一列，匹配时 grant AND NOT deny（AllowsCorpusScope）。
		DeniedCorpusURIs: overlay.denials.Corpus,
		// Phase C: 只冻 enabled 授权 skill 的 id（bundle 已过 enabled），让
		// disabled skill 既不进 L1，也不被 skill_use/skill_run_script 命中。
		SkillIDs:     skills.IDs,
		MCPServerIDs: role.MCPServerIDs(),
		// #109/#110: 冻下 role 的 ≤2 个 dock 按钮配置；session payload 层解析 title + 过滤 code-deny。
		DockButtons: role.DockButtons(),
		// ghost-steering: 冻 waypoints。先按 waypoint_id 把 code 的覆盖层叠在 role 之上
		// （role = 这个受众的目的地，code = 这一次邀约的），**再**按 role 授权 glob 过滤
		// （feasibility floor）—— 顺序要紧：过滤在合并之后，code 才不能借覆盖把 role 看不到的
		// 证据引导出来。evidence_refs 全越界的 waypoint 整条丢弃。
		Waypoints: domain.FilterWaypointsByCorpus(
			domain.MergeWaypoints(role.Waypoints(), overlay.waypoints), role.CorpusURIs()),
		// F-A-10: 有效开关 = code 覆盖(非 nil)否则 role 值。冻进 snapshot,ghost 选择时用。
		RequireGhostEvidence: effectiveGhostEvidence(
			role.RequireGhostEvidence(), overlay.requireGhostEvidence),
	}), nil
}

// effectiveGhostEvidence —— F-A-10 的 role/code 合并:code 显式覆盖(非 nil)则用 code,否则继承 role。
func effectiveGhostEvidence(roleVal bool, codeOverride *bool) bool {
	if codeOverride != nil {
		return *codeOverride
	}
	return roleVal
}

// loadPromptBody —— role 没挂 prompt 或挂的 prompt 不存在 → 返空串（public
// 之类 role 不一定有 prompt，session 没问题）。
func loadPromptBody(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, role *domain.Role,
) (string, error) {
	promptID, ok := role.PromptID()
	if !ok {
		return "", nil
	}
	return promptBodyByID(ctx, deps, ownerID, &promptID)
}

// promptBodyByID —— 按可选 prompt id 取 body（role prompt + #104 per-code prompt 共用）。
// nil / 不存在（SET NULL 删过）→ 空串（那段 persona 没有，session 照常）。
func promptBodyByID(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, promptID *string,
) (string, error) {
	if promptID == nil {
		return "", nil
	}
	prompt, err := deps.Prompts.GetByID(ctx, ownerID, *promptID)
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
