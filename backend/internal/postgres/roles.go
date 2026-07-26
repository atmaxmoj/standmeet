// roles.go —— roles 表 + role_corpus_uris / role_skills / role_mcp_servers
// join 表 CRUD。owner-scoped visitor 身份原型；设计 [[iam-role-pivot-plan]]。
//
// 主表 CRUD + 三组 attach/clear/list join helpers。
// SeedPublicRole 走 UpsertBuiltin 幂等种入；删除 builtin 被 SQL 谓词锁。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// RoleRepo —— roles + 3 个 join 表 CRUD。
type RoleRepo struct {
	pool *Pool
}

// NewRoleRepo 构造。
func NewRoleRepo(pool *Pool) *RoleRepo { return &RoleRepo{pool: pool} }

// CreateRoleInput —— Create 入参。PromptID nil = NULL；caller 已校验 prompt
// 属于同 owner。
type CreateRoleInput struct {
	PromptID             *string
	OwnerID              string
	Name                 string
	Description          string
	Greeting             string
	DockButtons          []access.DockButtonConfig
	NotifyOwnerOnBooking bool
}

// Create 新建 role 主表行（不挂任何 join 项；attach 在 caller usecase 内单独调）。
func (r *RoleRepo) Create(ctx context.Context, in *CreateRoleInput) (access.Role, error) {
	params, perr := buildCreateRoleParams(in)
	if perr != nil {
		return access.Role{}, perr
	}
	row, err := dbq.New(r.pool).CreateRole(ctx, params)
	if err != nil {
		return access.Role{}, mapRoleCreateErr(err)
	}
	return toDomainRoleBare(&row), nil
}

// buildCreateRoleParams —— 提出 owner/prompt UUID parse，降 Create 的 cyclo。
func buildCreateRoleParams(in *CreateRoleInput) (dbq.CreateRoleParams, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return dbq.CreateRoleParams{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	promptUUID, perr := optionalUUID(in.PromptID)
	if perr != nil {
		return dbq.CreateRoleParams{}, fmt.Errorf("parse prompt id: %w", perr)
	}
	dock, derr := marshalDockButtons(in.DockButtons)
	if derr != nil {
		return dbq.CreateRoleParams{}, derr
	}
	return dbq.CreateRoleParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description,
		Greeting: in.Greeting, PromptID: promptUUID,
		NotifyOwnerOnBooking: in.NotifyOwnerOnBooking, DockButtons: dock,
	}, nil
}

// mapRoleCreateErr —— 把 unique violation 翻成 domain sentinel。
func mapRoleCreateErr(err error) error {
	if name, hit := pgUniqueViolation(err); hit && name == "roles_owner_name_uniq" {
		return access.ErrRoleNameTaken
	}
	return fmt.Errorf("create role: %w", err)
}

// UpsertBuiltinInput —— SeedPublicRole 用。
type UpsertBuiltinInput struct {
	PromptID    *string
	OwnerID     string
	Name        string
	Description string
}

// UpsertBuiltin —— public role 幂等种入。同 (owner_id, name) 覆盖
// description + prompt_id。caller 之后用 SetCorpusURIs / SetSkills /
// SetMCPServers 同步 join 表（public 公开 corpus 三 glob、无 skill、无 mcp）。
func (r *RoleRepo) UpsertBuiltin(
	ctx context.Context, in *UpsertBuiltinInput,
) (access.Role, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return access.Role{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	promptUUID, perr := optionalUUID(in.PromptID)
	if perr != nil {
		return access.Role{}, fmt.Errorf("parse prompt id: %w", perr)
	}
	row, err := dbq.New(r.pool).UpsertBuiltinRole(ctx, dbq.UpsertBuiltinRoleParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description, PromptID: promptUUID,
	})
	if err != nil {
		return access.Role{}, fmt.Errorf("upsert builtin role: %w", err)
	}
	return toDomainRoleBare(&row), nil
}

// ListByOwner —— admin /admin/roles 列表 + visitor session issue 时 lookup。
// 返的 Role 已 hydrate 三组 join 项（join 走 N+1，N 在 visitor 维度通常 ≤ 5 不
// 优化；想优化在 commit 4 加 ListWithJoins 一个 batch query）。
func (r *RoleRepo) ListByOwner(ctx context.Context, ownerID string) ([]access.Role, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListRolesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	out := make([]access.Role, 0, len(rows))
	for i := range rows {
		hydrated, herr := hydrateRole(ctx, q, &rows[i])
		if herr != nil {
			return nil, herr
		}
		out = append(out, hydrated)
	}
	return out, nil
}

// GetByID —— 单条详情 hydrate 三组 join。
func (r *RoleRepo) GetByID(ctx context.Context, ownerID, roleID string) (access.Role, error) {
	args, perr := parseRoleIDArgs(ownerID, roleID)
	if perr != nil {
		return access.Role{}, perr
	}
	q := dbq.New(r.pool)
	row, err := q.GetRoleByID(ctx, dbq.GetRoleByIDParams{
		ID: args.roleUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return access.Role{}, access.ErrRoleNotFound
		}
		return access.Role{}, fmt.Errorf("get role: %w", err)
	}
	return hydrateRole(ctx, q, &row)
}

// GetByName —— SeedPublicRole / access_code 默认 role 查找。
func (r *RoleRepo) GetByName(ctx context.Context, ownerID, name string) (access.Role, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return access.Role{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	q := dbq.New(r.pool)
	row, err := q.GetRoleByName(ctx, dbq.GetRoleByNameParams{
		OwnerID: ownerUUID, Name: name,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return access.Role{}, access.ErrRoleNotFound
		}
		return access.Role{}, fmt.Errorf("get role by name: %w", err)
	}
	return hydrateRole(ctx, q, &row)
}

// UpdateRoleInput —— Update 入参。
type UpdateRoleInput struct {
	PromptID             *string
	OwnerID              string
	RoleID               string
	Name                 string
	Description          string
	Greeting             string
	DockButtons          []access.DockButtonConfig
	NotifyOwnerOnBooking bool
	RequireGhostEvidence bool
}

// Update 改 role 主表行（不动 join 表；caller 用 SetCorpusURIs / SetSkills /
// SetMCPServers 同步 join 表）。builtin rename 由 usecase 拦。
func (r *RoleRepo) Update(ctx context.Context, in *UpdateRoleInput) (access.Role, error) {
	args, perr := parseRoleIDArgs(in.OwnerID, in.RoleID)
	if perr != nil {
		return access.Role{}, perr
	}
	promptUUID, puerr := optionalUUID(in.PromptID)
	if puerr != nil {
		return access.Role{}, fmt.Errorf("parse prompt id: %w", puerr)
	}
	dock, derr := marshalDockButtons(in.DockButtons)
	if derr != nil {
		return access.Role{}, derr
	}
	row, err := dbq.New(r.pool).UpdateRole(ctx, dbq.UpdateRoleParams{
		ID: args.roleUUID, OwnerID: args.ownerUUID,
		Name: in.Name, Description: in.Description, Greeting: in.Greeting, PromptID: promptUUID,
		NotifyOwnerOnBooking: in.NotifyOwnerOnBooking, DockButtons: dock,
		RequireGhostEvidence: in.RequireGhostEvidence,
	})
	if err != nil {
		return access.Role{}, mapRoleUpdateErr(err)
	}
	return toDomainRoleBare(&row), nil
}

// NotifiesOwnerOnBooking —— #130: 约成时实时读这个 role 的通知开关。EXISTS 查询恒返
// 一行,role 不存在 / 开关关 → false(无 no-rows 特判)。
func (r *RoleRepo) NotifiesOwnerOnBooking(ctx context.Context, roleID string) (bool, error) {
	roleUUID, err := parseUUID(roleID)
	if err != nil {
		return false, fmt.Errorf("parse role id: %w", err)
	}
	on, qerr := dbq.New(r.pool).RoleNotifiesOwnerOnBooking(ctx, roleUUID)
	if qerr != nil {
		return false, fmt.Errorf("role notifies owner: %w", qerr)
	}
	return on, nil
}

// mapRoleUpdateErr —— 单独抽出来降 Update 的 cognitive complexity。
func mapRoleUpdateErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return access.ErrRoleNotFound
	}
	if name, hit := pgUniqueViolation(err); hit && name == "roles_owner_name_uniq" {
		return access.ErrRoleNameTaken
	}
	return fmt.Errorf("update role: %w", err)
}

// Delete —— 只删 non-builtin（SQL 谓词锁）。builtin 删请求 0 行影响，usecase 层
// 先 GetByID 看 IsBuiltin 拦。删主表会级联清空 3 个 join 表（FK CASCADE）。
func (r *RoleRepo) Delete(ctx context.Context, ownerID, roleID string) error {
	args, perr := parseRoleIDArgs(ownerID, roleID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(r.pool).DeleteRole(ctx, dbq.DeleteRoleParams{
		ID: args.roleUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete role: %w", err)
	}
	return nil
}

// CountActiveCodes —— /admin/roles 卡上 "N active codes" 指标用。
func (r *RoleRepo) CountActiveCodes(ctx context.Context, roleID string) (int64, error) {
	roleUUID, perr := parseUUID(roleID)
	if perr != nil {
		return 0, fmt.Errorf("parse role id: %w", perr)
	}
	count, err := dbq.New(r.pool).CountActiveCodesForRole(ctx, roleUUID)
	if err != nil {
		return 0, fmt.Errorf("count active codes for role: %w", err)
	}
	return count, nil
}

type roleIDArgs struct {
	roleUUID  pgtype.UUID
	ownerUUID pgtype.UUID
}

func parseRoleIDArgs(ownerID, roleID string) (roleIDArgs, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return roleIDArgs{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	roleUUID, rerr := parseUUID(roleID)
	if rerr != nil {
		return roleIDArgs{}, fmt.Errorf("parse role id: %w", rerr)
	}
	return roleIDArgs{ownerUUID: ownerUUID, roleUUID: roleUUID}, nil
}

func optionalUUID(s *string) (pgtype.UUID, error) {
	if s == nil || *s == "" {
		return pgtype.UUID{}, nil
	}
	return parseUUID(*s)
}

// toDomainRoleBare —— 不带 join 项的主表转换；Create/Update/UpsertBuiltin 用，
// caller 会随后调 SetCorpusURIs/SetSkills/SetMCPServers + GetByID 拿完整 Role。
// roleJoins —— hydrateRole 组装好的主行 + join 组，喂 toDomainRole（避开 argument-limit）。
type roleJoins struct {
	row          *dbq.Role
	corpusURIs   []string
	skillIDs     []string
	mcpServerIDs []string
	waypoints    []access.Waypoint
}

func toDomainRoleBare(row *dbq.Role) access.Role {
	return toDomainRole(&roleJoins{row: row})
}

func toDomainRole(j *roleJoins) access.Role {
	row := j.row
	var promptIDPtr *string
	if row.PromptID.Valid {
		s := formatUUID(row.PromptID)
		promptIDPtr = &s
	}
	return access.NewRole(&access.RoleInit{
		ID: formatUUID(row.ID), OwnerID: formatUUID(row.OwnerID),
		Name: row.Name, Description: row.Description, Greeting: row.Greeting,
		PromptID:   promptIDPtr,
		IsBuiltin:  row.IsBuiltin,
		CorpusURIs: j.corpusURIs, SkillIDs: j.skillIDs, MCPServerIDs: j.mcpServerIDs,
		Waypoints:            j.waypoints,
		DockButtons:          decodeDockButtons(row.DockButtons),
		NotifyOwnerOnBooking: row.NotifyOwnerOnBooking,
		RequireGhostEvidence: row.RequireGhostEvidence,
		CreatedAt:            row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	})
}
