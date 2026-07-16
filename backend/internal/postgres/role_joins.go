// role_joins.go —— roles 三组 join 表（role_corpus_uris / role_skills /
// role_mcp_servers）的 set/hydrate 操作。从 roles.go 拆出守 max-lines。
//
// 所有 set 操作走 clear + bulk insert 形态，跟 mcp_servers.SetCodeMCPServers
// 一致。caller usecase 已校验 join 项的 owner 归属。

package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// SetCorpusURIs —— clear + bulk insert role_corpus_uris。caller 已校验
// pattern 形态合理（commit 2 接 retriever 时加 validator）。
func (r *RoleRepo) SetCorpusURIs(ctx context.Context, roleID string, patterns []string) error {
	roleUUID, perr := parseUUID(roleID)
	if perr != nil {
		return fmt.Errorf("parse role id: %w", perr)
	}
	q := dbq.New(r.pool)
	if cerr := q.ClearRoleCorpusURIs(ctx, roleUUID); cerr != nil {
		return fmt.Errorf("clear role corpus uris: %w", cerr)
	}
	if len(patterns) == 0 {
		return nil
	}
	if aerr := q.AttachRoleCorpusURIs(ctx, dbq.AttachRoleCorpusURIsParams{
		RoleID: roleUUID, Column2: patterns,
	}); aerr != nil {
		return fmt.Errorf("attach role corpus uris: %w", aerr)
	}
	return nil
}

// SetWaypoints —— clear + 逐条 insert role_waypoints。evidence_refs 存 jsonb
// （json.Marshal []string）。caller usecase 已校验 waypoint 形态。
func (r *RoleRepo) SetWaypoints(
	ctx context.Context, roleID string, waypoints []domain.Waypoint,
) error {
	roleUUID, perr := parseUUID(roleID)
	if perr != nil {
		return fmt.Errorf("parse role id: %w", perr)
	}
	q := dbq.New(r.pool)
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
	ctx context.Context, q *dbq.Queries, roleUUID pgtype.UUID, w *domain.Waypoint,
) error {
	refs, merr := json.Marshal(w.EvidenceRefs)
	if merr != nil {
		return fmt.Errorf("marshal evidence_refs: %w", merr)
	}
	if aerr := q.AttachRoleWaypoint(ctx, dbq.AttachRoleWaypointParams{
		RoleID: roleUUID, WaypointID: w.WaypointID, Description: w.Description,
		Weight: int32(w.Weight), EvidenceRefs: refs, IsTerminal: w.IsTerminal,
	}); aerr != nil {
		return fmt.Errorf("attach role waypoint: %w", aerr)
	}
	return nil
}

// hydrateRoleWaypoints —— 读 role_waypoints → domain（行映射共用 waypointsFromRows）。
func hydrateRoleWaypoints(
	ctx context.Context, q *dbq.Queries, roleID pgtype.UUID,
) ([]domain.Waypoint, error) {
	rows, err := q.ListRoleWaypoints(ctx, roleID)
	if err != nil {
		return []domain.Waypoint{}, fmt.Errorf("list role waypoints: %w", err)
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

// SetSkills —— clear + bulk insert role_skills。caller 已校验 skill_ids 属于
// 同 owner。
func (r *RoleRepo) SetSkills(ctx context.Context, roleID string, skillIDs []string) error {
	q := dbq.New(r.pool)
	return setRoleUUIDJoin(ctx, &roleJoinOp{
		roleID: roleID, ids: skillIDs, tag: "skills",
		drop: q.ClearRoleSkills,
		bind: func(roleUUID pgtype.UUID, ids []pgtype.UUID) error {
			return q.AttachRoleSkills(ctx, dbq.AttachRoleSkillsParams{
				RoleID: roleUUID, Column2: ids,
			})
		},
	})
}

// SetMCPServers —— clear + bulk insert role_mcp_servers。caller 已校验
// server_ids 属于同 owner。
func (r *RoleRepo) SetMCPServers(ctx context.Context, roleID string, serverIDs []string) error {
	q := dbq.New(r.pool)
	return setRoleUUIDJoin(ctx, &roleJoinOp{
		roleID: roleID, ids: serverIDs, tag: "mcp_servers",
		drop: q.ClearRoleMCPServers,
		bind: func(roleUUID pgtype.UUID, ids []pgtype.UUID) error {
			return q.AttachRoleMCPServers(ctx, dbq.AttachRoleMCPServersParams{
				RoleID: roleUUID, Column2: ids,
			})
		},
	})
}

// roleJoinOp —— setRoleUUIDJoin 入参，bundle 起来避开 argument-limit。
// drop 调对应 ClearRole<X>，bind 调对应 AttachRole<X>。
type roleJoinOp struct {
	drop   func(context.Context, pgtype.UUID) error
	bind   func(pgtype.UUID, []pgtype.UUID) error
	roleID string
	tag    string
	ids    []string
}

// setRoleUUIDJoin —— SetSkills / SetMCPServers 共享的 clear-then-attach
// 框架。tag 只用于 err message。
func setRoleUUIDJoin(ctx context.Context, op *roleJoinOp) error {
	roleUUID, err := prepareRoleJoinClear(ctx, op)
	if err != nil {
		return err
	}
	if len(op.ids) == 0 {
		return nil
	}
	uuids, uerr := parseUUIDArray(op.ids)
	if uerr != nil {
		return fmt.Errorf("parse %s ids: %w", op.tag, uerr)
	}
	if aerr := op.bind(roleUUID, uuids); aerr != nil {
		return fmt.Errorf("attach role %s: %w", op.tag, aerr)
	}
	return nil
}

// prepareRoleJoinClear —— parse role uuid + 调 op.drop。提出来降
// setRoleUUIDJoin 的 cyclo。
func prepareRoleJoinClear(ctx context.Context, op *roleJoinOp) (pgtype.UUID, error) {
	roleUUID, perr := parseUUID(op.roleID)
	if perr != nil {
		return pgtype.UUID{}, fmt.Errorf("parse role id: %w", perr)
	}
	if cerr := op.drop(ctx, roleUUID); cerr != nil {
		return pgtype.UUID{}, fmt.Errorf("clear role %s: %w", op.tag, cerr)
	}
	return roleUUID, nil
}

// hydrateRole 从主表行起步，N+1 取 3 个 join 表组装完整 Role。
func hydrateRole(ctx context.Context, q *dbq.Queries, row *dbq.Role) (domain.Role, error) {
	corpusURIs, cerr := q.ListRoleCorpusURIs(ctx, row.ID)
	if cerr != nil {
		return domain.Role{}, fmt.Errorf("list role corpus uris: %w", cerr)
	}
	skillUUIDs, serr := q.ListRoleSkillIDs(ctx, row.ID)
	if serr != nil {
		return domain.Role{}, fmt.Errorf("list role skill ids: %w", serr)
	}
	mcpUUIDs, merr := q.ListRoleMCPServerIDs(ctx, row.ID)
	if merr != nil {
		return domain.Role{}, fmt.Errorf("list role mcp server ids: %w", merr)
	}
	waypoints, werr := hydrateRoleWaypoints(ctx, q, row.ID)
	if werr != nil {
		return domain.Role{}, werr
	}
	return toDomainRole(&roleJoins{
		row: row, corpusURIs: corpusURIs, skillIDs: uuidStrings(skillUUIDs),
		mcpServerIDs: uuidStrings(mcpUUIDs), waypoints: waypoints,
	}), nil
}

func uuidStrings(us []pgtype.UUID) []string {
	out := make([]string, 0, len(us))
	for _, u := range us {
		out = append(out, formatUUID(u))
	}
	return out
}
