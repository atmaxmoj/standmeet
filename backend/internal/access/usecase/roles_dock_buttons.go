// roles_dock_buttons.go —— #109/#110 per-role chat dock 按钮的 usecase 面：校验 + owner MCP
// set。跟 roles.go 同包（拆出来守 check-max-lines）。

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

// checkDockButtonsSubset —— dock 按钮校验：数量 ≤2 + 触发词非空（domain 纯不变量）+ 每个能力在
// route 给的 valid 集里。create/update 共用。
// checkWaypointsSubset —— ghost-steering 目的地的形态校验（同 dock buttons：规则在 domain，
// usecase 只包错误上下文）。role 面和 code 覆盖面共用 ValidateWaypoints 这一条规则。
func checkWaypointsSubset(in *RoleWriteInput) error {
	if err := entity.ValidateWaypoints(in.Waypoints); err != nil {
		return fmt.Errorf("waypoints: %w", err)
	}
	return nil
}

func checkDockButtonsSubset(in *RoleWriteInput) error {
	if err := entity.ValidateDockButtons(in.DockButtons); err != nil {
		return fmt.Errorf("dock buttons: %w", err)
	}
	capErr := entity.ValidateDockButtonCapabilities(in.DockButtons, in.ValidCapabilityIDs)
	if capErr != nil {
		return fmt.Errorf("dock buttons: %w", capErr)
	}
	return nil
}

// SetDockButtonsInput —— SetRoleDockButtons 入参（避开 6-arg limit）。
type SetDockButtonsInput struct {
	OwnerID            string
	RoleID             string
	Buttons            []entity.DockButtonConfig
	ValidCapabilityIDs []string
}

// SetRoleDockButtons —— owner MCP `roles.set_dock_buttons`：只改一个 role 的 dock 按钮。load
// 现有 role 保留其余字段 → 走 UpdateRole 同一套校验（≤2 / trigger / cap 有效），跟 admin UI
// 走同一份服务端逻辑（#118 parity）。
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
		DockButtons:        in.Buttons,
		ValidCapabilityIDs: in.ValidCapabilityIDs,
	}
	if pid, ok := role.PromptID(); ok {
		w.PromptID = &pid
	}
	return UpdateRole(ctx, deps, w)
}
