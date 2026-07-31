// wire_disp_roles.go —— access 域的 role 普通函数 → 出站收口的窄口。
//
// waypoints / dock_buttons 在收口那侧是原样透传的 JSON:它们的结构属于 access 域,
// 收口不该复制一份跟着域演进。解成域类型这件事落在这里。
//
// dock 按钮上能挂哪些能力,由能力注册表回答 —— 两个面本来就都问它,所以这里只取一次闭包。

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type roleOps struct {
	deps   access.RolesDeps
	capIDs func() []string
}

// newRoleOps —— capIDs 是**惰性**的:能力注册表(agentSkills)要等 registerAgentSkills 跑完
// 才齐,而收口在那之前就建好了。存闭包而不是快照,否则 dock 按钮会拿到一张空的合法能力表。
func newRoleOps(d *runtimeDeps) roleOps {
	return roleOps{
		deps: access.RolesDeps{
			Roles: d.roleRepo,
			Refs: roleRefValidator{
				prompts: d.promptRepo, skills: d.skillRepo, servers: d.mcpServerRepo,
			},
		},
		capIDs: func() []string { return d.agentSkills.VisitorCapabilityIDs() },
	}
}

func (a roleOps) List(ctx context.Context, ownerID string) ([]dispatcher.Role, error) {
	rows, err := access.ListRoles(ctx, a.deps, ownerID)
	if err != nil {
		return nil, roleErr(err)
	}
	out := make([]dispatcher.Role, 0, len(rows))
	for i := range rows {
		out = append(out, a.hydrate(ctx, &rows[i]))
	}
	return out, nil
}

func (a roleOps) Get(ctx context.Context, ownerID, id string) (dispatcher.Role, error) {
	rl, err := access.GetRole(ctx, a.deps, ownerID, id)
	if err != nil {
		return dispatcher.Role{}, roleErr(err)
	}
	return a.hydrate(ctx, &rl), nil
}

func (a roleOps) Create(
	ctx context.Context, in *dispatcher.WriteRole,
) (dispatcher.Role, error) {
	return a.write(ctx, in, access.CreateRole)
}

func (a roleOps) Update(
	ctx context.Context, in *dispatcher.WriteRole,
) (dispatcher.Role, error) {
	return a.write(ctx, in, access.UpdateRole)
}

func (a roleOps) Delete(ctx context.Context, ownerID, id string) error {
	return roleErr(access.DeleteRole(ctx, a.deps, ownerID, id))
}

func (a roleOps) SetDockButtons(
	ctx context.Context, ownerID, id string, buttons json.RawMessage,
) (dispatcher.Role, error) {
	parsed, perr := decodeDockButtons(buttons)
	if perr != nil {
		return dispatcher.Role{}, perr
	}
	rl, err := access.SetRoleDockButtons(ctx, a.deps, &access.SetDockButtonsInput{
		OwnerID: ownerID, RoleID: id, Buttons: parsed, ValidCapabilityIDs: a.capIDs(),
	})
	if err != nil {
		return dispatcher.Role{}, roleErr(err)
	}
	return a.hydrate(ctx, &rl), nil
}

// write —— create / update 只差调哪个用例;入参转换和回包 hydrate 是同一份。
func (a roleOps) write(
	ctx context.Context, in *dispatcher.WriteRole,
	apply func(context.Context, access.RolesDeps, *access.RoleWriteInput) (access.Role, error),
) (dispatcher.Role, error) {
	converted, cerr := a.toRoleWriteInput(in)
	if cerr != nil {
		return dispatcher.Role{}, cerr
	}
	rl, err := apply(ctx, a.deps, converted)
	if err != nil {
		return dispatcher.Role{}, roleErr(err)
	}
	return a.hydrate(ctx, &rl), nil
}

func (a roleOps) toRoleWriteInput(in *dispatcher.WriteRole) (*access.RoleWriteInput, error) {
	waypoints, werr := decodeWaypoints(in.Waypoints)
	if werr != nil {
		return nil, werr
	}
	buttons, berr := decodeDockButtons(in.DockButtons)
	if berr != nil {
		return nil, berr
	}
	return &access.RoleWriteInput{
		OwnerID: in.OwnerID, RoleID: in.ID, Name: in.Name, Description: in.Description,
		Greeting: in.Greeting, PromptID: in.PromptID, CorpusURIs: in.CorpusURIs,
		SkillIDs: in.SkillIDs, MCPServerIDs: in.MCPServerIDs,
		Waypoints: waypoints, DockButtons: buttons, ValidCapabilityIDs: a.capIDs(),
		NotifyOwnerOnBooking: in.NotifyOwnerOnBooking,
		RequireGhostEvidence: in.RequireGhostEvidence,
	}, nil
}

// hydrate —— 域实体 → 收口形状,顺带补上活跃码计数。计数失败不该让整条读操作失败
// (它是展示用的旁证),记 0 并继续 —— admin 面一直是这个行为。
func (a roleOps) hydrate(ctx context.Context, rl *access.Role) dispatcher.Role {
	count, cerr := access.CountActiveCodesForRole(ctx, a.deps, rl.OwnerID(), rl.ID())
	if cerr != nil {
		count = 0
	}
	out := dispatcher.Role{
		ID: rl.ID(), Name: rl.Name(), Description: rl.Description(),
		Greeting: rl.Greeting(), CorpusURIs: rl.CorpusURIs(), SkillIDs: rl.SkillIDs(),
		MCPServerIDs: rl.MCPServerIDs(), ActiveCodes: count, IsBuiltin: rl.IsBuiltin(),
		NotifyOwnerOnBooking: rl.NotifyOwnerOnBooking(),
		RequireGhostEvidence: rl.RequireGhostEvidence(),
		CreatedAt:            rl.CreatedAt(), UpdatedAt: rl.UpdatedAt(),
		Waypoints:   encodeList(rl.Waypoints()),
		DockButtons: encodeList(rl.DockButtons()),
	}
	if pid, ok := rl.PromptID(); ok {
		out.PromptID = &pid
	}
	return out
}

func decodeWaypoints(raw json.RawMessage) ([]access.Waypoint, error) {
	out := []access.Waypoint{}
	if len(raw) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		//nolint:wrapcheck // 类别错误原样上抛
		return nil, dispatcher.BadInput("waypoints must be an array of waypoint objects")
	}
	return out, nil
}

func decodeDockButtons(raw json.RawMessage) ([]access.DockButtonConfig, error) {
	out := []access.DockButtonConfig{}
	if len(raw) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		//nolint:wrapcheck // 类别错误原样上抛
		return nil, dispatcher.BadInput("dock_buttons must be an array of {capability_id, trigger}")
	}
	return out, nil
}

// roleListItem —— role 上那两个原样透传的列表字段。写成具名约束而不是 any:
// 这条边界只服务这两种值,写死了就没人能顺手把别的东西塞进来。
type roleListItem interface {
	access.Waypoint | access.DockButtonConfig
}

// encodeList —— 域实体里的列表 → 出站 JSON。nil 编成 [],不是 null
// (项目原则:容器永不为 nil)。
//
// 编码失败只可能是这些值本身不可序列化 —— 那是程序错,不是这次请求的错。这里退成 []
// 而不是让整条读操作 500:少一个展示字段,比 owner 整个列表打不开要好。
func encodeList[T roleListItem](items []T) json.RawMessage {
	if len(items) == 0 {
		return json.RawMessage(`[]`)
	}
	out, err := json.Marshal(items)
	if err != nil {
		return json.RawMessage(`[]`)
	}
	return out
}

func roleErr(err error) error {
	if err == nil {
		return nil
	}
	if classed := classifyRoleErr(err); classed != nil {
		return classed
	}
	return fmt.Errorf("role op: %w", err)
}

func classifyRoleErr(err error) error {
	for _, c := range roleErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return nil
}

var roleErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error { return dispatcher.BadInput("name is required") }},
	{access.ErrTooManyDockButtons, func() error {
		return dispatcher.BadInput("at most two dock buttons")
	}},
	{access.ErrDockButtonEmptyTrigger, func() error {
		return dispatcher.BadInput("dock button needs a trigger")
	}},
	{access.ErrUnknownDockCapability, func() error {
		return dispatcher.BadInput("unknown dock capability")
	}},
	{owner.ErrPromptNotFound, func() error {
		return dispatcher.BadInput("prompt id not found for this owner")
	}},
	{marketplace.ErrSkillNotFound, func() error {
		return dispatcher.BadInput("one or more skill ids not found")
	}},
	{marketplace.ErrMCPServerNotFound, func() error {
		return dispatcher.BadInput("one or more mcp server ids not found")
	}},
	// 这三个的 code 是**已经发出去的契约**(前端 / e2e 按 code 分流),所以显式钉住 ——
	// 不能退成类别默认的 not_found / forbidden / conflict,那样载荷说的话就变少了。
	{access.ErrRoleNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("role not found"), "role_not_found")
	}},
	{access.ErrRoleBuiltinImmutable, func() error {
		return dispatcher.Coded(
			dispatcher.Forbidden("builtin role cannot be renamed"), "role_builtin_immutable")
	}},
	{access.ErrRoleNameTaken, func() error {
		return dispatcher.Coded(
			dispatcher.Conflict("role name already taken"), "role_name_taken")
	}},
}
