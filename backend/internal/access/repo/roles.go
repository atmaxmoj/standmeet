// roles.go —— roles 表 + role_corpus_uris / role_skills / role_mcp_servers
// join 表 CRUD。owner-scoped visitor 身份原型；设计 [[iam-role-pivot-plan]]。
//
// 主表 CRUD + 三组 attach/clear/list join helpers。
// SeedPublicRole 走 UpsertBuiltin 幂等种入；删除 builtin 被 SQL 谓词锁。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// RoleRepo —— roles + 3 个 join 表 CRUD。
type RoleRepo struct {
	pool *pgstore.Pool
}

// NewRoleRepo 构造。
func NewRoleRepo(pool *pgstore.Pool) *RoleRepo { return &RoleRepo{pool: pool} }

// CreateRoleInput —— Create 入参。PromptID nil = NULL；caller 已校验 prompt
// 属于同 owner。
type CreateRoleInput struct {
	PromptID    *string
	OwnerID     string
	Name        string
	Description string
	Greeting    string
	DockButtons []entity.DockButtonConfig
}

// Create 新建 role 主表行（不挂任何 join 项；attach 在 caller usecase 内单独调）。
func (r *RoleRepo) Create(ctx context.Context, in *CreateRoleInput) (entity.Role, error) {
	params, perr := buildCreateRoleParams(in)
	if perr != nil {
		return entity.Role{}, perr
	}
	row, err := db.New(r.pool).CreateRole(ctx, params)
	if err != nil {
		return entity.Role{}, mapRoleCreateErr(err)
	}
	return toDomainRoleBare(&row), nil
}

// buildCreateRoleParams —— 提出 owner/prompt UUID parse，降 Create 的 cyclo。
func buildCreateRoleParams(in *CreateRoleInput) (db.CreateRoleParams, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return db.CreateRoleParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	promptUUID, perr := pgstore.ParseOptionalUUID(in.PromptID)
	if perr != nil {
		return db.CreateRoleParams{}, fmt.Errorf("parse prompt id: %w", perr)
	}
	dock, derr := marshalDockButtons(in.DockButtons)
	if derr != nil {
		return db.CreateRoleParams{}, derr
	}
	return db.CreateRoleParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description,
		Greeting: in.Greeting, PromptID: promptUUID,
		DockButtons: dock,
	}, nil
}

// mapRoleCreateErr —— 把 unique violation 翻成 domain sentinel。
func mapRoleCreateErr(err error) error {
	if name, hit := pgstore.UniqueViolation(err); hit && name == "roles_owner_name_uniq" {
		return entity.ErrRoleNameTaken
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
) (entity.Role, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return entity.Role{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	promptUUID, perr := pgstore.ParseOptionalUUID(in.PromptID)
	if perr != nil {
		return entity.Role{}, fmt.Errorf("parse prompt id: %w", perr)
	}
	row, err := db.New(r.pool).UpsertBuiltinRole(ctx, db.UpsertBuiltinRoleParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description, PromptID: promptUUID,
	})
	if err != nil {
		return entity.Role{}, fmt.Errorf("upsert builtin role: %w", err)
	}
	return toDomainRoleBare(&row), nil
}

// ListByOwner —— admin /admin/roles 列表 + visitor session issue 时 lookup。
// 返的 Role 已 hydrate 三组 join 项（join 走 N+1，N 在 visitor 维度通常 ≤ 5 不
// 优化；想优化在 commit 4 加 ListWithJoins 一个 batch query）。
func (r *RoleRepo) ListByOwner(ctx context.Context, ownerID string) ([]entity.Role, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	q := db.New(r.pool)
	rows, err := q.ListRolesByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	out := make([]entity.Role, 0, len(rows))
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
func (r *RoleRepo) GetByID(ctx context.Context, ownerID, roleID string) (entity.Role, error) {
	args, perr := parseRoleIDArgs(ownerID, roleID)
	if perr != nil {
		return entity.Role{}, perr
	}
	q := db.New(r.pool)
	row, err := q.GetRoleByID(ctx, db.GetRoleByIDParams{
		ID: args.roleUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Role{}, entity.ErrRoleNotFound
		}
		return entity.Role{}, fmt.Errorf("get role: %w", err)
	}
	return hydrateRole(ctx, q, &row)
}

// GetByName —— SeedPublicRole / access_code 默认 role 查找。
func (r *RoleRepo) GetByName(ctx context.Context, ownerID, name string) (entity.Role, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Role{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	q := db.New(r.pool)
	row, err := q.GetRoleByName(ctx, db.GetRoleByNameParams{
		OwnerID: ownerUUID, Name: name,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Role{}, entity.ErrRoleNotFound
		}
		return entity.Role{}, fmt.Errorf("get role by name: %w", err)
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
	DockButtons          []entity.DockButtonConfig
	RequireGhostEvidence bool
}

// Update 改 role 主表行（不动 join 表；caller 用 SetCorpusURIs / SetSkills /
// SetMCPServers 同步 join 表）。builtin rename 由 usecase 拦。
func (r *RoleRepo) Update(ctx context.Context, in *UpdateRoleInput) (entity.Role, error) {
	args, perr := parseRoleIDArgs(in.OwnerID, in.RoleID)
	if perr != nil {
		return entity.Role{}, perr
	}
	promptUUID, puerr := pgstore.ParseOptionalUUID(in.PromptID)
	if puerr != nil {
		return entity.Role{}, fmt.Errorf("parse prompt id: %w", puerr)
	}
	dock, derr := marshalDockButtons(in.DockButtons)
	if derr != nil {
		return entity.Role{}, derr
	}
	row, err := db.New(r.pool).UpdateRole(ctx, db.UpdateRoleParams{
		ID: args.roleUUID, OwnerID: args.ownerUUID,
		Name: in.Name, Description: in.Description, Greeting: in.Greeting, PromptID: promptUUID,
		DockButtons:          dock,
		RequireGhostEvidence: in.RequireGhostEvidence,
	})
	if err != nil {
		return entity.Role{}, mapRoleUpdateErr(err)
	}
	return toDomainRoleBare(&row), nil
}

// 这里以前有 NotifiesOwnerOnBooking —— 约成时实时读 role 的通知开关。**零调用方**:
// 它从建好起就没有人调过,真正在用的一直是冻进 role snapshot 的那一份。那个开关现在是
// calendar.book 自己的 role_config,这个方法和它背后那条专用 query 一起删。

// mapRoleUpdateErr —— 单独抽出来降 Update 的 cognitive complexity。
func mapRoleUpdateErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrRoleNotFound
	}
	if name, hit := pgstore.UniqueViolation(err); hit && name == "roles_owner_name_uniq" {
		return entity.ErrRoleNameTaken
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
	if err := db.New(r.pool).DeleteRole(ctx, db.DeleteRoleParams{
		ID: args.roleUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete role: %w", err)
	}
	return nil
}

// CountActiveCodes —— /admin/roles 卡上 "N active codes" 指标用。
func (r *RoleRepo) CountActiveCodes(ctx context.Context, roleID string) (int64, error) {
	roleUUID, perr := pgstore.ParseUUID(roleID)
	if perr != nil {
		return 0, fmt.Errorf("parse role id: %w", perr)
	}
	count, err := db.New(r.pool).CountActiveCodesForRole(ctx, roleUUID)
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
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return roleIDArgs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	roleUUID, rerr := pgstore.ParseUUID(roleID)
	if rerr != nil {
		return roleIDArgs{}, fmt.Errorf("parse role id: %w", rerr)
	}
	return roleIDArgs{ownerUUID: ownerUUID, roleUUID: roleUUID}, nil
}

// toDomainRoleBare —— 不带 join 项的主表转换；Create/Update/UpsertBuiltin 用，
// caller 会随后调 SetCorpusURIs/SetSkills/SetMCPServers + GetByID 拿完整 Role。
// roleJoins —— hydrateRole 组装好的主行 + join 组，喂 toDomainRole（避开 argument-limit）。
type roleJoins struct {
	row          *db.Role
	corpusURIs   []string
	skillIDs     []string
	mcpServerIDs []string
	waypoints    []entity.Waypoint
}

func toDomainRoleBare(row *db.Role) entity.Role {
	return toDomainRole(&roleJoins{row: row})
}

func toDomainRole(j *roleJoins) entity.Role {
	row := j.row
	var promptIDPtr *string
	if row.PromptID.Valid {
		s := pgstore.FormatUUID(row.PromptID)
		promptIDPtr = &s
	}
	return entity.NewRole(&entity.RoleInit{
		ID: pgstore.FormatUUID(row.ID), OwnerID: pgstore.FormatUUID(row.OwnerID),
		Name: row.Name, Description: row.Description, Greeting: row.Greeting,
		PromptID:   promptIDPtr,
		IsBuiltin:  row.IsBuiltin,
		CorpusURIs: j.corpusURIs, SkillIDs: j.skillIDs, MCPServerIDs: j.mcpServerIDs,
		Waypoints:            j.waypoints,
		DockButtons:          decodeDockButtons(row.DockButtons),
		RequireGhostEvidence: row.RequireGhostEvidence,
		CreatedAt:            row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	})
}
