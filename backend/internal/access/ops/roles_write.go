// roles_write.go —— 建 / 改一个 role 的解参与转交(声明在 roles.go)。
//
// waypoints / dock_buttons 是本域自己的结构,所以在这里直接解成域类型 —— 归一化前它们要
// 先在收口那侧当作不透明 JSON 透传一次,再在组装根解一次。

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

type roleWriteArgs struct {
	PromptID    *string `json:"prompt_id"`
	RoleID      string  `json:"role_id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Greeting    string  `json:"greeting"`
	// ProviderID —— 这个 role 用哪条 provider(空 = owner 默认);挂在码上的那条压过它。
	ProviderID   string                    `json:"provider_id"`
	CorpusURIs   []string                  `json:"corpus_uris"`
	SkillIDs     []string                  `json:"skill_ids"`
	MCPServerIDs []string                  `json:"mcp_server_ids"`
	Waypoints    []entity.Waypoint         `json:"waypoints"`
	DockButtons  []entity.DockButtonConfig `json:"dock_buttons"`

	RequireGhostEvidence bool `json:"require_ghost_evidence"`
	// GasMetered —— 这个 role 挂不挂油表(false = 一次 gas 查询都不发,跟今天同一条路)。
	GasMetered bool `json:"gas_metered"`
}

func decodeRoleCreate(raw json.RawMessage) (roleWriteArgs, error) {
	var in roleWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"name", in.Name})
}

// decodeRoleUpdate —— 跟 create 一样,外加必填的 role_id。
func decodeRoleUpdate(raw json.RawMessage) (roleWriteArgs, error) {
	in, err := decodeRoleCreate(raw)
	if err != nil {
		return in, err
	}
	return in, fp.RequireArgs([2]string{"role_id", in.RoleID})
}

// roleWriteApply —— create / update 只差调哪个用例;解参、转换和回包是同一份。
type roleWriteApply func(
	ctx context.Context, deps usecase.RolesDeps, in *usecase.RoleWriteInput,
) (entity.Role, error)

func writeRole(
	d RolesDeps, extras RoleExtras, apply roleWriteApply,
	decode func(json.RawMessage) (roleWriteArgs, error),
) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decode(raw)
		if perr != nil {
			return nil, perr
		}
		rl, err := apply(ctx, d.Roles, toRoleWriteInput(d, ownerID, &in))
		if err != nil {
			return nil, roleErr(err)
		}
		// 各能力自己那几个字段:整份原始入参递过去让它们自己挑。写失败不回滚 role ——
		// role 已经建好了,设置可以再改(失败在那一层留日志)。
		extras.Write(ctx, rl.ID(), raw)
		return marshalRole(ctx, d.Roles, extras, &rl)
	}
}

func toRoleWriteInput(d RolesDeps, ownerID string, in *roleWriteArgs) *usecase.RoleWriteInput {
	return &usecase.RoleWriteInput{
		OwnerID: ownerID, RoleID: in.RoleID, Name: in.Name, Description: in.Description,
		Greeting: in.Greeting, PromptID: in.PromptID,
		CorpusURIs:   nonNilStrings(in.CorpusURIs),
		SkillIDs:     nonNilStrings(in.SkillIDs),
		MCPServerIDs: nonNilStrings(in.MCPServerIDs),
		Waypoints:    nonNilWaypoints(in.Waypoints),
		DockButtons:  nonNilDockButtons(in.DockButtons),
		// dock 按钮上能挂哪些能力,由能力注册表回答 —— 每次写都现问一次。
		ValidCapabilityIDs:   d.ValidCapabilityIDs(),
		RequireGhostEvidence: in.RequireGhostEvidence,
		ProviderID:           in.ProviderID,
		GasMetered:           in.GasMetered,
	}
}

// roleErr —— 域的哨兵 → 协议无关的类别。
//
// 挂载引用那三条走的是本域端口自己的哨兵(见 usecase/role_ports.go):owner 和
// marketplace 已经依赖 access,access 再认它们的错误名字就成了反向依赖。
func roleErr(err error) error {
	for _, c := range roleErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("role op", err)
}

// roleDeleteErr —— 删和改共用 ErrRoleBuiltinImmutable 这一个哨兵,但给人看的话得跟
// 当下这件事对上:删 builtin 回"不能删",不是"不能改名"。
func roleDeleteErr(err error) error {
	if errors.Is(err, entity.ErrRoleBuiltinImmutable) {
		return fp.Coded(
			fp.Forbidden("builtin role cannot be deleted"), "role_builtin_immutable")
	}
	return roleErr(err)
}

var roleErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error { return fp.BadInput("name is required") }},
	{entity.ErrTooManyDockButtons, func() error {
		return fp.BadInput("at most two dock buttons")
	}},
	{entity.ErrDockButtonEmptyTrigger, func() error {
		return fp.BadInput("dock button needs a trigger")
	}},
	{entity.ErrUnknownDockCapability, func() error {
		return fp.BadInput("unknown dock capability")
	}},
	{usecase.ErrRefPromptNotFound, func() error {
		return fp.BadInput("prompt id not found for this owner")
	}},
	{usecase.ErrRefSkillNotFound, func() error {
		return fp.BadInput("one or more skill ids not found")
	}},
	{usecase.ErrRefMCPServerNotFound, func() error {
		return fp.BadInput("one or more mcp server ids not found")
	}},
	// 这三个的 code 是**已经发出去的契约**(前端 / e2e 按 code 分流),所以显式钉住 ——
	// 不能退成类别默认的 not_found / forbidden / conflict,那样载荷说的话就变少了。
	{entity.ErrRoleNotFound, func() error {
		return fp.Coded(fp.NotFound("role not found"), "role_not_found")
	}},
	{entity.ErrRoleBuiltinImmutable, func() error {
		return fp.Coded(
			fp.Forbidden("builtin role cannot be renamed"), "role_builtin_immutable")
	}},
	{entity.ErrRoleNameTaken, func() error {
		return fp.Coded(fp.Conflict("role name already taken"), "role_name_taken")
	}},
}
