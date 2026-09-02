// role_joins.go —— the set/hydrate operations for roles' three join tables
// (role_corpus_uris / role_skills / role_mcp_servers). Split out of roles.go to
// respect max-lines.
//
// Every set operation follows the clear + bulk insert shape, consistent with
// mcp_servers.SetCodeMCPServers. The caller usecase has already checked owner
// ownership of the join items.

package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SetCorpusURIs —— clear + bulk insert role_corpus_uris. The caller has already
// checked the pattern shape is sane (a validator gets added when commit 2 wires
// up the retriever).
func (r *RoleRepo) SetCorpusURIs(ctx context.Context, roleID string, patterns []string) error {
	roleUUID, perr := pgstore.ParseUUID(roleID)
	if perr != nil {
		return fmt.Errorf("parse role id: %w", perr)
	}
	q := db.New(r.pool)
	if cerr := q.ClearRoleCorpusURIs(ctx, roleUUID); cerr != nil {
		return fmt.Errorf("clear role corpus uris: %w", cerr)
	}
	if len(patterns) == 0 {
		return nil
	}
	if aerr := q.AttachRoleCorpusURIs(ctx, db.AttachRoleCorpusURIsParams{
		RoleID: roleUUID, Column2: patterns,
	}); aerr != nil {
		return fmt.Errorf("attach role corpus uris: %w", aerr)
	}
	return nil
}

// SetWaypoints —— clear + insert role_waypoints one row at a time. evidence_refs
// is stored as jsonb (json.Marshal of []string). The caller usecase has already
// checked the waypoint shape.
func (r *RoleRepo) SetWaypoints(
	ctx context.Context, roleID string, waypoints []entity.Waypoint,
) error {
	roleUUID, perr := pgstore.ParseUUID(roleID)
	if perr != nil {
		return fmt.Errorf("parse role id: %w", perr)
	}
	q := db.New(r.pool)
	if cerr := q.ClearRoleWaypoints(ctx, roleUUID); cerr != nil {
		return fmt.Errorf("clear role waypoints: %w", cerr)
	}
	for i := range waypoints {
		if aerr := attachWaypoint(ctx, q, roleUUID, &waypoints[i]); aerr != nil {
			return aerr
		}
	}
	return nil
}

func attachWaypoint(
	ctx context.Context, q *db.Queries, roleUUID pgtype.UUID, w *entity.Waypoint,
) error {
	refs, merr := json.Marshal(w.EvidenceRefs)
	if merr != nil {
		return fmt.Errorf("marshal evidence_refs: %w", merr)
	}
	if aerr := q.AttachRoleWaypoint(ctx, db.AttachRoleWaypointParams{
		RoleID: roleUUID, WaypointID: w.WaypointID, Description: w.Description,
		Weight: int32(w.Weight), EvidenceRefs: refs, IsTerminal: w.IsTerminal,
	}); aerr != nil {
		return fmt.Errorf("attach role waypoint: %w", aerr)
	}
	return nil
}

// hydrateRoleWaypoints —— reads role_waypoints → domain (row mapping shares
// waypointsFromRows).
func hydrateRoleWaypoints(
	ctx context.Context, q *db.Queries, roleID pgtype.UUID,
) ([]entity.Waypoint, error) {
	rows, err := q.ListRoleWaypoints(ctx, roleID)
	if err != nil {
		return []entity.Waypoint{}, fmt.Errorf("list role waypoints: %w", err)
	}
	shaped := make([]waypointRow, len(rows))
	for i := range rows {
		shaped[i] = waypointRow{
			WaypointID: rows[i].WaypointID, Description: rows[i].Description,
			EvidenceRefs: rows[i].EvidenceRefs, Weight: rows[i].Weight,
			IsTerminal: rows[i].IsTerminal,
		}
	}
	return waypointsFromRows(shaped)
}

// SetSkills —— clear + bulk insert role_skills. The caller has already checked
// skill_ids belong to the same owner.
func (r *RoleRepo) SetSkills(ctx context.Context, roleID string, skillIDs []string) error {
	q := db.New(r.pool)
	return setRoleUUIDJoin(ctx, &roleJoinOp{
		roleID: roleID, ids: skillIDs, tag: "skills",
		drop: q.ClearRoleSkills,
		bind: func(roleUUID pgtype.UUID, ids []pgtype.UUID) error {
			return q.AttachRoleSkills(ctx, db.AttachRoleSkillsParams{
				RoleID: roleUUID, Column2: ids,
			})
		},
	})
}

// SetMCPServers —— clear + bulk insert role_mcp_servers. The caller has already
// checked server_ids belong to the same owner.
func (r *RoleRepo) SetMCPServers(ctx context.Context, roleID string, serverIDs []string) error {
	q := db.New(r.pool)
	return setRoleUUIDJoin(ctx, &roleJoinOp{
		roleID: roleID, ids: serverIDs, tag: "mcp_servers",
		drop: q.ClearRoleMCPServers,
		bind: func(roleUUID pgtype.UUID, ids []pgtype.UUID) error {
			return q.AttachRoleMCPServers(ctx, db.AttachRoleMCPServersParams{
				RoleID: roleUUID, Column2: ids,
			})
		},
	})
}

// roleJoinOp —— inputs for setRoleUUIDJoin, bundled up to work around the
// argument-limit. drop calls the matching ClearRole<X>, bind calls the matching
// AttachRole<X>.
type roleJoinOp struct {
	drop   func(context.Context, pgtype.UUID) error
	bind   func(pgtype.UUID, []pgtype.UUID) error
	roleID string
	tag    string
	ids    []string
}

// setRoleUUIDJoin —— the clear-then-attach framework shared by SetSkills /
// SetMCPServers. tag is used only in error messages.
func setRoleUUIDJoin(ctx context.Context, op *roleJoinOp) error {
	roleUUID, err := prepareRoleJoinClear(ctx, op)
	if err != nil {
		return err
	}
	if len(op.ids) == 0 {
		return nil
	}
	uuids, uerr := pgstore.ParseUUIDArray(op.ids)
	if uerr != nil {
		return fmt.Errorf("parse %s ids: %w", op.tag, uerr)
	}
	if aerr := op.bind(roleUUID, uuids); aerr != nil {
		return fmt.Errorf("attach role %s: %w", op.tag, aerr)
	}
	return nil
}

// prepareRoleJoinClear —— parses the role uuid + calls op.drop. Pulled out to
// lower setRoleUUIDJoin's cyclomatic complexity.
func prepareRoleJoinClear(ctx context.Context, op *roleJoinOp) (pgtype.UUID, error) {
	roleUUID, perr := pgstore.ParseUUID(op.roleID)
	if perr != nil {
		return pgtype.UUID{}, fmt.Errorf("parse role id: %w", perr)
	}
	if cerr := op.drop(ctx, roleUUID); cerr != nil {
		return pgtype.UUID{}, fmt.Errorf("clear role %s: %w", op.tag, cerr)
	}
	return roleUUID, nil
}

// hydrateRole starts from the main-table row and does an N+1 fetch across the 3
// join tables to assemble the full Role.
func hydrateRole(ctx context.Context, q *db.Queries, row *db.Role) (entity.Role, error) {
	corpusURIs, cerr := q.ListRoleCorpusURIs(ctx, row.ID)
	if cerr != nil {
		return entity.Role{}, fmt.Errorf("list role corpus uris: %w", cerr)
	}
	skillUUIDs, serr := q.ListRoleSkillIDs(ctx, row.ID)
	if serr != nil {
		return entity.Role{}, fmt.Errorf("list role skill ids: %w", serr)
	}
	mcpUUIDs, merr := q.ListRoleMCPServerIDs(ctx, row.ID)
	if merr != nil {
		return entity.Role{}, fmt.Errorf("list role mcp server ids: %w", merr)
	}
	waypoints, werr := hydrateRoleWaypoints(ctx, q, row.ID)
	if werr != nil {
		return entity.Role{}, werr
	}
	return toDomainRole(&roleJoins{
		row: row, corpusURIs: corpusURIs, skillIDs: pgstore.UUIDStrings(skillUUIDs),
		mcpServerIDs: pgstore.UUIDStrings(mcpUUIDs), waypoints: waypoints,
	}), nil
}
