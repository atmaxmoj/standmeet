// roles_dock_buttons.go — the usecase face for #109/#110 per-role chat dock buttons:
// validation + owner MCP set. Same package as roles.go (split out to satisfy
// check-max-lines).

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

// checkDockButtonsSubset — dock button validation: count ≤2 + non-empty trigger word
// (a pure domain invariant) + each capability is in the valid set the route gives.
// Shared by create/update.
// checkWaypointsSubset — shape validation for ghost-steering destinations (same
// pattern as dock buttons: the rule lives in the domain, usecase only wraps the
// error context). The role face and the code override face share this one
// ValidateWaypoints rule.
func checkWaypointsSubset(in *RoleWriteInput) error {
	if err := entity.ValidateWaypoints(in.Waypoints); err != nil {
		return fmt.Errorf("waypoints: %w", err)
	}
	return nil
}

// checkDockButtonsSubset — the valid capability set is **computed fresh from this
// write's skill list**: an `acl: role_granted` capability only shows up in a session
// if this role's skills actually grant it (`RoleSnapshot.AllowsCapability` is the same
// rule). Using the whole instance's registry as the whitelist would accept a button a
// visitor can never see (F-D-13).
func checkDockButtonsSubset(ctx context.Context, in *RoleWriteInput) error {
	if err := entity.ValidateDockButtons(in.DockButtons); err != nil {
		return fmt.Errorf("dock buttons: %w", err)
	}
	if in.DockableCapabilityIDs == nil {
		return nil
	}
	valid := in.DockableCapabilityIDs(ctx, in.OwnerID, in.SkillIDs)
	capErr := entity.ValidateDockButtonCapabilities(in.DockButtons, valid)
	if capErr != nil {
		return fmt.Errorf("dock buttons: %w", capErr)
	}
	return nil
}

// SetDockButtonsInput — SetRoleDockButtons input (avoids the 6-arg limit).
type SetDockButtonsInput struct {
	// DockableCapabilityIDs — see the same field on RoleWriteInput: computed fresh
	// from the role's skills, not a fixed full table.
	DockableCapabilityIDs func(ctx context.Context, ownerID string, skillIDs []string) []string
	OwnerID               string
	RoleID                string
	Buttons               []entity.DockButtonConfig
}

// SetRoleDockButtons — owner MCP `roles.set_dock_buttons`: changes only one role's
// dock buttons. Loads the existing role to preserve its other fields → goes through
// the same UpdateRole validation (≤2 / trigger / cap valid), running the same
// server-side logic as the admin UI (#118 parity).
func SetRoleDockButtons(
	ctx context.Context, deps RolesDeps, in *SetDockButtonsInput,
) (entity.Role, error) {
	role, err := GetRole(ctx, deps, in.OwnerID, in.RoleID)
	if err != nil {
		return entity.Role{}, err
	}
	w := &RoleWriteInput{
		OwnerID: in.OwnerID, RoleID: in.RoleID,
		Name: role.Name(), Description: role.Description(), Greeting: role.Greeting(),
		CorpusURIs: role.CorpusURIs(), SkillIDs: role.SkillIDs(), MCPServerIDs: role.MCPServerIDs(),
		DockButtons:           in.Buttons,
		DockableCapabilityIDs: in.DockableCapabilityIDs,
	}
	if pid, ok := role.PromptID(); ok {
		w.PromptID = &pid
	}
	return UpdateRole(ctx, deps, w)
}
