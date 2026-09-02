// roles.go — CRUD for the owner-curated Role (a visitor identity prototype).
//
// Role = persona (Prompt) + visible corpus URI globs + skills + mcp servers.
// AccessCode references assumed_role_id; session start freezes [[role_snapshot]].
//
// public (is_builtin=true) is seeded by SeedPublicRole at claim time: can't be
// deleted / renamed, but corpus URIs / skills / mcp / description / prompt stay
// owner-editable.
//
// Create / Update both take corpus_uris + skill_ids + mcp_server_ids and set the
// join tables together. Validation: prompt + skill + mcp must belong to the same
// owner; empty corpus_uris is allowed (owner chose "expose nothing", = deny-all).

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// RolesDeps — repos needed by roles CRUD. Skills / MCPServers / Prompts validate
// join items' owner ownership on Create/Update.
type RolesDeps struct {
	Roles *repo.RoleRepo
	Refs  RefValidator
}

// RoleWriteInput — the shared input shape for Create / Update. RoleID is required
// on Update, empty on Create.
type RoleWriteInput struct {
	PromptID *string // 0..1; nil = no prompt mounted
	// DockableCapabilityIDs — "given this role's skill list, which capabilities can
	// the dock hold". A **function**, not a fixed list: an `acl: role_granted`
	// capability only counts if this write's SkillIDs actually grant it. A fixed
	// list would ask "which capabilities does this instance register" instead —
	// broader than the session side — letting the admin panel offer a button the
	// visitor could never see (F-D-13). nil = skip validation (caller guarantees it).
	DockableCapabilityIDs func(ctx context.Context, ownerID string, skillIDs []string) []string
	OwnerID               string
	RoleID                string // filled only on Update
	Name                  string
	Description           string
	Greeting              string
	// ProviderID — which provider this role uses (empty = owner's default). The
	// one on the code overrides this.
	ProviderID           string
	CorpusURIs           []string
	SkillIDs             []string
	MCPServerIDs         []string
	Waypoints            []entity.Waypoint         // ghost-steering destinations, per-role
	DockButtons          []entity.DockButtonConfig // #109/#110, up to 2 chat dock buttons
	RequireGhostEvidence bool                      // F-A-10 per-role switch
	GasMetered           bool                      // false = never issues a gas query
}

// CreateRole creates a new role + syncs the three join tables.
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
		// RequireGhostEvidence — must be passed on create too (F-Q-4): it used to be
		// passed only on the update path, so `role_create
		// {require_ghost_evidence:true}` silently came out with the switch off —
		// the one that gates "the AI must have evidence before it answers" — while
		// GasMetered/ProviderID beside it were passed. The compiler couldn't catch it.
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

// ListRoles — admin / MCP role.list.
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

// GetRole — admin / MCP role.get.
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

// UpdateRole — changes the role main table + resets the three join sets. builtin
// (public) can change prompt/corpus_uris/skills/mcp/description, not name (blocked
// by usecase).
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

// updateRoleMissingRequired — whether Update's required fields are missing (split
// out to lower validateUpdateRoleInput's cyclomatic complexity).
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

// DeleteRole — builtin can't be deleted; FK ON DELETE RESTRICT means access_codes
// still using this role block the delete (normal case: reassign, then delete).
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

// validateRoleDeletable — checks required fields + existence + non-builtin.
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

// CountActiveCodesForRole — the "N active codes" metric on the /admin/roles card.
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

// reloadRole — combined main-table + join-table query, used at end of Create/Update.
func reloadRole(
	ctx context.Context, deps RolesDeps, ownerID, roleID string,
) (entity.Role, error) {
	role, err := deps.Roles.GetByID(ctx, ownerID, roleID)
	if err != nil {
		return entity.Role{}, fmt.Errorf("reload role: %w", err)
	}
	return role, nil
}

// syncRoleJoins — syncs the three join sets: corpus_uris / skill_ids /
// mcp_server_ids.
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

// checkRoleRenameAllowed — a builtin role can't be renamed.
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

// validateRoleJoinOwnership — PromptID/SkillIDs/MCPServerIDs must all belong to the
// same owner (defends against owner_id forgery).
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
