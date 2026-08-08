// code_waypoints.go —— ghost-steering 目的地的 **per-code 覆盖层**（mirrors role_joins.go 的
// role_waypoints 三面：Set / hydrate）。
//
// role 是「这个受众」的目的地，code 是「这一次邀约」的：一张招聘码想给通用 role 加一个只属于
// 本次的目的地、或把某条 weight 调高，不该被迫复制整份清单。合并语义在 MergeWaypoints
// （同 waypoint_id → code 覆盖，新 id → 追加），授权过滤仍由冻结那刻的
// FilterWaypointsByCorpus 统一执行 —— code 覆盖不能松掉授权下限。
//
// 这里只存/读 **覆盖层本身**（不含继承来的 role 的）；合并发生在 snapshot 装配。

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

// SetWaypoints —— clear + 逐条 insert code_waypoints（空 slice = 清空覆盖层 → 完全继承 role）。
func (r *CodeRepo) SetWaypoints(
	ctx context.Context, codeID string, waypoints []entity.Waypoint,
) error {
	codeUUID, perr := pgstore.ParseUUID(codeID)
	if perr != nil {
		return fmt.Errorf("parse code id: %w", perr)
	}
	q := db.New(r.pool)
	if cerr := q.ClearCodeWaypoints(ctx, codeUUID); cerr != nil {
		return fmt.Errorf("clear code waypoints: %w", cerr)
	}
	for i := range waypoints {
		if aerr := attachCodeWaypoint(ctx, q, codeUUID, &waypoints[i]); aerr != nil {
			return aerr
		}
	}
	return nil
}

func attachCodeWaypoint(
	ctx context.Context, q *db.Queries, codeUUID pgtype.UUID, w *entity.Waypoint,
) error {
	refs, merr := json.Marshal(w.EvidenceRefs)
	if merr != nil {
		return fmt.Errorf("marshal evidence_refs: %w", merr)
	}
	if aerr := q.AttachCodeWaypoint(ctx, db.AttachCodeWaypointParams{
		CodeID: codeUUID, WaypointID: w.WaypointID, Description: w.Description,
		Weight: int32(w.Weight), EvidenceRefs: refs, IsTerminal: w.IsTerminal,
	}); aerr != nil {
		return fmt.Errorf("attach code waypoint: %w", aerr)
	}
	return nil
}

// Waypoints —— 读一张 code 的覆盖层。没配 → 空 slice（caller 合并时等于完全继承 role）。
func (r *CodeRepo) Waypoints(ctx context.Context, codeID string) ([]entity.Waypoint, error) {
	codeUUID, perr := pgstore.ParseUUID(codeID)
	if perr != nil {
		return []entity.Waypoint{}, fmt.Errorf("parse code id: %w", perr)
	}
	return hydrateCodeWaypoints(ctx, db.New(r.pool), codeUUID)
}

// hydrateCodeWaypoints —— 读 code_waypoints → domain（行映射共用 waypointsFromRows）。
func hydrateCodeWaypoints(
	ctx context.Context, q *db.Queries, codeID pgtype.UUID,
) ([]entity.Waypoint, error) {
	rows, err := q.ListCodeWaypoints(ctx, codeID)
	if err != nil {
		return []entity.Waypoint{}, fmt.Errorf("list code waypoints: %w", err)
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
