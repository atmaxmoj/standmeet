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
	PromptID *string `json:"prompt_id"`
	// 这两样是**指针**:裸 bool 分不出「没提到」和「明确关掉」,而这两格都是安全开关 ——
	// 「答话前必须有引证」被一次改名顺手关掉过(F-Q-3)。nil = 不动。
	RequireGhostEvidence *bool `json:"require_ghost_evidence"`
	// GasMetered —— 这个 role 挂不挂油表(false = 一次 gas 查询都不发,跟今天同一条路)。
	GasMetered  *bool  `json:"gas_metered"`
	RoleID      string `json:"role_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Greeting    string `json:"greeting"`
	// ProviderID —— 这个 role 用哪条 provider(空 = owner 默认);挂在码上的那条压过它。
	ProviderID   string                    `json:"provider_id"`
	CorpusURIs   []string                  `json:"corpus_uris"`
	SkillIDs     []string                  `json:"skill_ids"`
	MCPServerIDs []string                  `json:"mcp_server_ids"`
	Waypoints    []entity.Waypoint         `json:"waypoints"`
	DockButtons  []entity.DockButtonConfig `json:"dock_buttons"`
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
		if kerr := keepUnmentioned(ctx, d, ownerID, &in); kerr != nil {
			return nil, roleErr(kerr)
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

// boolOr —— 建的那条路上没给就是这个默认值(改那条路已经在 keepUnmentioned 里填过了)。
func boolOr(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

// keepUnmentioned —— **改**一个 role 的时候,请求里没提到的授权字段沿用它现在的值。
//
// 为什么必须这样(F-Q-3):`role_update` 收的必填只有 `role_id` + `name`,所以 owner 的 AI
// 说一句「把这个角色改个名」发的就是那两样。在这之前,缺席一律被当成"设成空" ——
// 于是**改个名字就把这个 role 的语料 ACL 清空、技能摘掉、外部 MCP server 摘掉,
// 并把「答话前必须有引证」这条安全开关关掉**,而回执报成功。
//
// **「沿用」是这里唯一不发明授权的选择**:它永远不会多给什么,只会保住 owner 已经给过的
// (对照 [[invented-default-grants-privilege]] —— 会出事的是顺手发明的那个默认值,
// 而"静默撤销"同样是一次没人要求的授权变更)。
//
// 建的那条路不走这里:新 role 没有"现在的值"可沿用,缺席就是空,那是对的。
//
// 清空仍然做得到,而且面板一直就是这么做的:**显式发 `[]`**。JSON 分得开"没这个字段"(nil)
// 和"给了空数组"—— 需要的只是有人去读那个区别。
func keepUnmentioned(
	ctx context.Context, d RolesDeps, ownerID string, in *roleWriteArgs,
) error {
	if in.RoleID == "" {
		return nil // create:没有前值可沿用
	}
	cur, err := usecase.GetRole(ctx, d.Roles, ownerID, in.RoleID)
	if err != nil {
		return err
	}
	keepGrants(&cur, in)
	keepSwitches(&cur, in)
	return nil
}

// keepIDs —— 「请求里没这个字段(nil)就沿用现在的;给了 `[]` 就是明确清空」。
// 三组 id 列表共用它 —— 同一句话抄三遍的话,漏掉一个不会有人发现。
// 泛型版本被 forbidigo 挡下:`any` 在业务代码里是禁词。
func keepIDs(dst *[]string, cur []string) {
	if *dst == nil {
		*dst = cur
	}
}

// keepGrants —— 这个 role 被授予了什么(语料 ACL / 技能 / 外部 server / 引导点 / dock 按钮)。
func keepGrants(cur *entity.Role, in *roleWriteArgs) {
	keepIDs(&in.CorpusURIs, cur.CorpusURIs())
	keepIDs(&in.SkillIDs, cur.SkillIDs())
	keepIDs(&in.MCPServerIDs, cur.MCPServerIDs())
	if in.Waypoints == nil {
		in.Waypoints = cur.Waypoints()
	}
	if in.DockButtons == nil {
		in.DockButtons = cur.DockButtons()
	}
}

// keepSwitches —— 这个 role 上的两个开关。分开写不只是为了绕过复杂度上限:
// 它们跟上面那组的**失手代价不一样** —— 少一条 ACL 是少给,而 require_ghost_evidence
// 被关掉是**多给**(AI 不再需要引证就能答)。
func keepSwitches(cur *entity.Role, in *roleWriteArgs) {
	if in.RequireGhostEvidence == nil {
		v := cur.RequireGhostEvidence()
		in.RequireGhostEvidence = &v
	}
	if in.GasMetered == nil {
		v := cur.GasMetered()
		in.GasMetered = &v
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
		// dock 按钮上能挂哪些能力,由能力注册表回答 —— 每次写都现问一次,而且**按这个 role
		// 的技能问**(`acl: role_granted` 的能力要技能授了才算)。
		DockableCapabilityIDs: d.ValidCapabilityIDs,
		RequireGhostEvidence:  boolOr(in.RequireGhostEvidence, false),
		ProviderID:            in.ProviderID,
		GasMetered:            boolOr(in.GasMetered, false),
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
	// 两种情况共用这一句，而它对两种都是真话：id 拼错了，或者这个能力要 role 的技能授权而
	// 这个 role 没授。上一版说的是「unknown dock capability」—— 对后一种是假的（那个能力好好
	// 地装在实例上），而 owner 会去找一个根本不存在的拼写错误（F-D-13）。
	{entity.ErrUnknownDockCapability, func() error {
		return fp.BadInput(
			"this role can't show that capability — check the id, or grant it to the role's skills")
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
