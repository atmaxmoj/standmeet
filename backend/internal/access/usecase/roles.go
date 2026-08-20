// roles.go —— owner-curated Role (visitor 身份原型) CRUD。
//
// Role = persona (Prompt) + 可见 corpus URI globs + skills + mcp servers。
// AccessCode 引 assumed_role_id；session start 时 freeze [[role_snapshot]]。
//
// public（is_builtin=true）由 claim 时 SeedPublicRole 种入，不可删 / 不可改
// name；其它字段（corpus URIs / skills / mcp / description / prompt）owner 可改。
//
// Create / Update 都接 corpus_uris + skill_ids + mcp_server_ids 一并设置 join
// 表。校验：prompt + skill + mcp 都属于同 owner；空 corpus_uris 允许 (owner
// 显式选了"啥都不开"，等同 deny-all)。

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// RolesDeps —— roles CRUD 需要的 repos。Skills / MCPServers / Prompts 用来
// 在 Create/Update 时校验 join 项的 owner 归属。
type RolesDeps struct {
	Roles *repo.RoleRepo
	Refs  RefValidator
}

// RoleWriteInput —— Create / Update 共用的入参形态。Update 时 RoleID 必填，
// Create 时 RoleID 空。
type RoleWriteInput struct {
	PromptID *string // 0..1；nil = 不挂 prompt
	// DockableCapabilityIDs —— 「一个技能列表长这样的 role，dock 上挂得住哪些能力」。
	//
	// 是个**函数**而不是名单：`acl: role_granted` 的能力要这个 role 的技能真的授了它才算数，
	// 所以只有拿到**这次写入的** SkillIDs 才答得出来。传名单的那一版问的是「这台实例注册了
	// 哪些访客能力」，比会话那一侧宽，差集里的按钮后台收得下、访客永远看不到（F-D-13）。
	// nil = 不校验（内部调用方自己保证）。
	DockableCapabilityIDs func(ctx context.Context, ownerID string, skillIDs []string) []string
	OwnerID               string
	RoleID                string // Update 才填
	Name                  string
	Description           string
	Greeting              string
	// ProviderID —— 这个 role 用哪条 provider(空 = owner 默认)。码上那条压过它。
	ProviderID   string
	CorpusURIs   []string
	SkillIDs     []string
	MCPServerIDs []string
	// Waypoints —— ghost-steering 引导目的地（owner per-role 写）。
	Waypoints []entity.Waypoint
	// DockButtons —— #109/#110 ≤2 个 chat dock 按钮。
	DockButtons []entity.DockButtonConfig
	// RequireGhostEvidence —— F-A-10 per-role 开关。
	RequireGhostEvidence bool
	// GasMetered —— 挂不挂油表。false = 一次 gas 查询都不发。
	GasMetered bool
}

// CreateRole 新建 role + 同步三组 join 表。
func CreateRole(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) (entity.Role, error) {
	if verr := validateCreateRoleInput(ctx, deps, in); verr != nil {
		return entity.Role{}, verr
	}
	role, err := createRoleRow(ctx, deps, in)
	if err != nil {
		return entity.Role{}, err
	}
	if serr := syncRoleJoins(ctx, deps, role.ID(), in); serr != nil {
		return entity.Role{}, serr
	}
	return reloadRole(ctx, deps, in.OwnerID, role.ID())
}

func validateCreateRoleInput(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) error {
	if in.OwnerID == "" || in.Name == "" {
		return apierr.ErrEmptyField
	}
	if derr := checkDockButtonsSubset(ctx, in); derr != nil {
		return derr
	}
	if werr := checkWaypointsSubset(in); werr != nil {
		return werr
	}
	return validateRoleJoinOwnership(ctx, deps, in)
}

func createRoleRow(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) (entity.Role, error) {
	role, err := deps.Roles.Create(ctx, &repo.CreateRoleInput{
		OwnerID: in.OwnerID, Name: in.Name,
		Description: in.Description, Greeting: in.Greeting, PromptID: in.PromptID,
		DockButtons: in.DockButtons, ProviderID: in.ProviderID,
		GasMetered: in.GasMetered,
		// RequireGhostEvidence —— 建的时候也要传（F-Q-4）。这一格以前只在**改**那条路上
		// 传（`updateRoleRow`），建那条路把它漏了：`role_create {require_ghost_evidence:true}`
		// 建出来的 role，这个开关是关的 —— 而它管的是「AI 答话前必须先有引证」。
		// 旁边的 GasMetered / ProviderID 都传了，只有它没有，编译当然不报。
		RequireGhostEvidence: in.RequireGhostEvidence,
	})
	if err != nil {
		if errors.Is(err, entity.ErrRoleNameTaken) {
			return entity.Role{}, entity.ErrRoleNameTaken
		}
		return entity.Role{}, fmt.Errorf("create role: %w", err)
	}
	return role, nil
}

// ListRoles —— admin / MCP role.list。
func ListRoles(
	ctx context.Context, deps RolesDeps, ownerID string,
) ([]entity.Role, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Roles.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	return rows, nil
}

// GetRole —— admin / MCP role.get。
func GetRole(
	ctx context.Context, deps RolesDeps, ownerID, roleID string,
) (entity.Role, error) {
	if ownerID == "" || roleID == "" {
		return entity.Role{}, apierr.ErrEmptyField
	}
	role, err := deps.Roles.GetByID(ctx, ownerID, roleID)
	if err != nil {
		return entity.Role{}, fmt.Errorf("get role: %w", err)
	}
	return role, nil
}

// UpdateRole —— 改 role 主表 + 重设三组 join。builtin (public) 可改 prompt /
// corpus_uris / skills / mcp / description，但不可改 name（usecase 拦）。
func UpdateRole(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) (entity.Role, error) {
	if verr := validateUpdateRoleInput(ctx, deps, in); verr != nil {
		return entity.Role{}, verr
	}
	role, err := updateRoleRow(ctx, deps, in)
	if err != nil {
		return entity.Role{}, err
	}
	if serr := syncRoleJoins(ctx, deps, role.ID(), in); serr != nil {
		return entity.Role{}, serr
	}
	return reloadRole(ctx, deps, in.OwnerID, role.ID())
}

func validateUpdateRoleInput(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) error {
	if updateRoleMissingRequired(in) {
		return apierr.ErrEmptyField
	}
	if cerr := checkRoleRenameAllowed(ctx, deps, in); cerr != nil {
		return cerr
	}
	if derr := checkDockButtonsSubset(ctx, in); derr != nil {
		return derr
	}
	if werr := checkWaypointsSubset(in); werr != nil {
		return werr
	}
	return validateRoleJoinOwnership(ctx, deps, in)
}

// updateRoleMissingRequired —— Update 必填字段是否缺（抽出降 validateUpdateRoleInput 的 cyclo）。
func updateRoleMissingRequired(in *RoleWriteInput) bool {
	return in.OwnerID == "" || in.RoleID == "" || in.Name == ""
}

func updateRoleRow(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) (entity.Role, error) {
	role, err := deps.Roles.Update(ctx, &repo.UpdateRoleInput{
		OwnerID: in.OwnerID, RoleID: in.RoleID, Name: in.Name,
		Description: in.Description, Greeting: in.Greeting, PromptID: in.PromptID,
		DockButtons:          in.DockButtons,
		RequireGhostEvidence: in.RequireGhostEvidence,
		ProviderID:           in.ProviderID,
		GasMetered:           in.GasMetered,
	})
	if err != nil {
		return entity.Role{}, fmt.Errorf("update role: %w", err)
	}
	return role, nil
}

// DeleteRole —— builtin 不能删；FK ON DELETE RESTRICT 让正在用此 role 的
// access_codes 阻止删（commit 3 commit 之后正常情况，先 reassign 再 delete）。
func DeleteRole(
	ctx context.Context, deps RolesDeps, ownerID, roleID string,
) error {
	if verr := validateRoleDeletable(ctx, deps, ownerID, roleID); verr != nil {
		return verr
	}
	if err := deps.Roles.Delete(ctx, ownerID, roleID); err != nil {
		return fmt.Errorf("delete role: %w", err)
	}
	return nil
}

// validateRoleDeletable —— 必填 + 存在 + 非 builtin 检查。
func validateRoleDeletable(
	ctx context.Context, deps RolesDeps, ownerID, roleID string,
) error {
	if ownerID == "" || roleID == "" {
		return apierr.ErrEmptyField
	}
	role, gerr := deps.Roles.GetByID(ctx, ownerID, roleID)
	if gerr != nil {
		return fmt.Errorf("get role: %w", gerr)
	}
	if role.IsBuiltin() {
		return entity.ErrRoleBuiltinImmutable
	}
	return nil
}

// CountActiveCodesForRole —— /admin/roles 卡上 "N active codes" 指标。
func CountActiveCodesForRole(
	ctx context.Context, deps RolesDeps, ownerID, roleID string,
) (int64, error) {
	if _, gerr := deps.Roles.GetByID(ctx, ownerID, roleID); gerr != nil {
		return 0, fmt.Errorf("get role for count: %w", gerr)
	}
	count, err := deps.Roles.CountActiveCodes(ctx, roleID)
	if err != nil {
		return 0, fmt.Errorf("count active codes: %w", err)
	}
	return count, nil
}

// reloadRole —— 主表 + join 表合一的查询，Create/Update 末尾用。
func reloadRole(
	ctx context.Context, deps RolesDeps, ownerID, roleID string,
) (entity.Role, error) {
	role, err := deps.Roles.GetByID(ctx, ownerID, roleID)
	if err != nil {
		return entity.Role{}, fmt.Errorf("reload role: %w", err)
	}
	return role, nil
}

// syncRoleJoins —— 同步 corpus_uris / skill_ids / mcp_server_ids 三组 join。
func syncRoleJoins(
	ctx context.Context, deps RolesDeps, roleID string, in *RoleWriteInput,
) error {
	if err := deps.Roles.SetCorpusURIs(ctx, roleID, in.CorpusURIs); err != nil {
		return fmt.Errorf("set role corpus uris: %w", err)
	}
	if err := deps.Roles.SetSkills(ctx, roleID, in.SkillIDs); err != nil {
		return fmt.Errorf("set role skills: %w", err)
	}
	if err := deps.Roles.SetMCPServers(ctx, roleID, in.MCPServerIDs); err != nil {
		return fmt.Errorf("set role mcp servers: %w", err)
	}
	if err := deps.Roles.SetWaypoints(ctx, roleID, in.Waypoints); err != nil {
		return fmt.Errorf("set role waypoints: %w", err)
	}
	return nil
}

// checkRoleRenameAllowed —— builtin role 不能 rename。
func checkRoleRenameAllowed(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) error {
	existing, err := deps.Roles.GetByID(ctx, in.OwnerID, in.RoleID)
	if err != nil {
		return fmt.Errorf("get role for rename check: %w", err)
	}
	if existing.IsBuiltin() && existing.Name() != in.Name {
		return entity.ErrRoleBuiltinImmutable
	}
	return nil
}

// validateRoleJoinOwnership —— PromptID / SkillIDs / MCPServerIDs 都必须属于
// 同 owner（防御 owner_id forge）。
func validateRoleJoinOwnership(
	ctx context.Context, deps RolesDeps, in *RoleWriteInput,
) error {
	if perr := validateRolePrompt(ctx, deps, in.OwnerID, in.PromptID); perr != nil {
		return perr
	}
	if serr := validateRoleSkills(ctx, deps, in.OwnerID, in.SkillIDs); serr != nil {
		return serr
	}
	return validateRoleMCPServers(ctx, deps, in.OwnerID, in.MCPServerIDs)
}

func validateRolePrompt(
	ctx context.Context, deps RolesDeps, ownerID string, promptID *string,
) error {
	if promptID == nil || *promptID == "" {
		return nil
	}
	if err := deps.Refs.RefExists(ctx, ownerID, RefPrompt, *promptID); err != nil {
		return fmt.Errorf("validate prompt %s: %w", *promptID, err)
	}
	return nil
}

func validateRoleSkills(
	ctx context.Context, deps RolesDeps, ownerID string, skillIDs []string,
) error {
	for _, sid := range skillIDs {
		if err := deps.Refs.RefExists(ctx, ownerID, RefSkill, sid); err != nil {
			return fmt.Errorf("validate skill %s: %w", sid, err)
		}
	}
	return nil
}

func validateRoleMCPServers(
	ctx context.Context, deps RolesDeps, ownerID string, mcpIDs []string,
) error {
	for _, mid := range mcpIDs {
		if err := deps.Refs.RefExists(ctx, ownerID, RefMCPServer, mid); err != nil {
			return fmt.Errorf("validate mcp server %s: %w", mid, err)
		}
	}
	return nil
}
