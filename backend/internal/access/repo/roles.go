// roles.go —— CRUD for roles + its role_corpus_uris/role_skills/role_mcp_servers
// join tables. Owner-scoped visitor identity prototype; see design
// [[iam-role-pivot-plan]]. SeedPublicRole seeds idempotently via UpsertBuiltin;
// a SQL predicate blocks deleting a builtin.

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

// RoleRepo —— CRUD for roles + its 3 join tables.
type RoleRepo struct {
	pool *pgstore.Pool
}

// NewRoleRepo constructs a RoleRepo.
func NewRoleRepo(pool *pgstore.Pool) *RoleRepo { return &RoleRepo{pool: pool} }

// CreateRoleInput —— inputs for Create. PromptID nil = NULL; caller already
// checked the prompt belongs to the same owner.
type CreateRoleInput struct {
	PromptID    *string
	OwnerID     string
	Name        string
	Description string
	Greeting    string
	ProviderID  string // empty = not specified (uses the owner's default)
	DockButtons []entity.DockButtonConfig
	// GasMetered, RequireGhostEvidence —— both must persist at creation (both are
	// in role.create's input table; F-Q-4: GasMetered was fixed first, this one
	// missed the same pass — kept adjacent as a reminder for the next switch).
	GasMetered           bool
	RequireGhostEvidence bool
}

// Create creates a new role main-table row (attaches no join items; those are
// called separately by the caller usecase).
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

// buildCreateRoleParams —— owner/prompt UUID parsing, pulled out to lower Create's complexity.
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
	providerUUID, pverr := pgstore.ParseOptionalUUID(optStr(in.ProviderID))
	if pverr != nil {
		return db.CreateRoleParams{}, fmt.Errorf("parse provider id: %w", pverr)
	}
	return db.CreateRoleParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description,
		Greeting: in.Greeting, PromptID: promptUUID,
		DockButtons: dock, ProviderID: providerUUID, GasMetered: in.GasMetered,
		RequireGhostEvidence: in.RequireGhostEvidence,
	}, nil
}

// mapRoleCreateErr —— translates a unique violation into a domain sentinel error.
func mapRoleCreateErr(err error) error {
	if name, hit := pgstore.UniqueViolation(err); hit && name == "roles_owner_name_uniq" {
		return entity.ErrRoleNameTaken
	}
	return fmt.Errorf("create role: %w", err)
}

// UpsertBuiltinInput —— used by SeedPublicRole.
type UpsertBuiltinInput struct {
	PromptID    *string
	OwnerID     string
	Name        string
	Description string
}

// UpsertBuiltin —— idempotently seeds the public role; same (owner_id, name)
// overwrites description + prompt_id. Caller then syncs join tables with
// SetCorpusURIs / SetSkills / SetMCPServers (public: 3 corpus globs, no
// skills, no mcp).
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

// ListByOwner —— used by the admin /admin/roles listing and the visitor-session
// lookup. Returned Roles have their three join groups hydrated (each join is
// N+1; N is usually ≤5 on the visitor dimension so unoptimized — a batch
// ListWithJoins query in commit 4 would fix that).
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

// GetByID —— hydrates the three join groups for a single detail view.
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

// GetByName —— used by SeedPublicRole and the access_code default-role lookup.
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

// UpdateRoleInput —— inputs for Update.
type UpdateRoleInput struct {
	PromptID             *string
	OwnerID              string
	RoleID               string
	Name                 string
	Description          string
	Greeting             string
	ProviderID           string // empty = not specified (column is NULL)
	DockButtons          []entity.DockButtonConfig
	RequireGhostEvidence bool
	GasMetered           bool // whether to attach a gas meter
}

// Update changes a role main-table row (join tables untouched; caller syncs
// those with SetCorpusURIs/SetSkills/SetMCPServers). Renaming a builtin is
// blocked by the usecase layer.
func (r *RoleRepo) Update(ctx context.Context, in *UpdateRoleInput) (entity.Role, error) {
	params, perr := buildUpdateRoleParams(in)
	if perr != nil {
		return entity.Role{}, perr
	}
	row, err := db.New(r.pool).UpdateRole(ctx, params)
	if err != nil {
		return entity.Role{}, mapRoleUpdateErr(err)
	}
	return toDomainRoleBare(&row), nil
}

// buildUpdateRoleParams —— parses two ids + prompt/provider + serializes dock,
// leaving Update to just send the SQL. Symmetric with buildCreateRoleParams.
func buildUpdateRoleParams(in *UpdateRoleInput) (db.UpdateRoleParams, error) {
	args, perr := parseRoleIDArgs(in.OwnerID, in.RoleID)
	if perr != nil {
		return db.UpdateRoleParams{}, perr
	}
	promptUUID, puerr := pgstore.ParseOptionalUUID(in.PromptID)
	if puerr != nil {
		return db.UpdateRoleParams{}, fmt.Errorf("parse prompt id: %w", puerr)
	}
	providerUUID, pverr := pgstore.ParseOptionalUUID(optStr(in.ProviderID))
	if pverr != nil {
		return db.UpdateRoleParams{}, fmt.Errorf("parse provider id: %w", pverr)
	}
	dock, derr := marshalDockButtons(in.DockButtons)
	if derr != nil {
		return db.UpdateRoleParams{}, derr
	}
	return db.UpdateRoleParams{
		ID: args.roleUUID, OwnerID: args.ownerUUID,
		Name: in.Name, Description: in.Description, Greeting: in.Greeting, PromptID: promptUUID,
		DockButtons:          dock,
		RequireGhostEvidence: in.RequireGhostEvidence,
		ProviderID:           providerUUID,
		GasMetered:           in.GasMetered,
	}, nil
}

// NotifiesOwnerOnBooking used to live here (read a role's notification switch
// live on booking). Zero callers ever — the frozen copy in the role snapshot
// was what's used. Now lives in calendar.book's own role_config; deleted.

// mapRoleUpdateErr —— pulled out on its own to lower Update's cognitive complexity.
func mapRoleUpdateErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrRoleNotFound
	}
	if name, hit := pgstore.UniqueViolation(err); hit && name == "roles_owner_name_uniq" {
		return entity.ErrRoleNameTaken
	}
	return fmt.Errorf("update role: %w", err)
}

// Delete —— deletes only non-builtin roles (locked by a SQL predicate); a
// builtin delete affects 0 rows, so usecase checks IsBuiltin via GetByID first
// and blocks it there. Cascades the 3 join tables (FK CASCADE).
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

// CountActiveCodes —— used for the "N active codes" metric on the /admin/roles card.
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

// toDomainRoleBare converts the main-table row without join items (used by
// Create/Update/UpsertBuiltin; caller then calls SetCorpusURIs/SetSkills/
// SetMCPServers + GetByID for the full Role). roleJoins is the main row +
// join groups from hydrateRole, fed to toDomainRole (dodges the arg-limit).
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
		// Empty = not specified (NULL, or its row was deleted — ON DELETE SET NULL).
		ProviderID: pgstore.UUIDStrOrEmpty(row.ProviderID),
		GasMetered: row.GasMetered,
		CreatedAt:  row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	})
}
