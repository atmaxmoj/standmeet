// code_waypoints.go —— the **per-code override layer** for ghost-steering destinations
// (mirrors role_joins.go's role_waypoints trio: Set / hydrate).
//
// A role's destinations belong to "this audience"; a code's belong to "this one
// invitation": a recruiting code wants to add one destination that's only for this
// occasion, or bump one weight, on top of a generic role — without being forced to
// duplicate the whole list. The merge semantics live in MergeWaypoints (same
// waypoint_id → code overrides, new id → appended); authorization filtering is still
// enforced uniformly by FilterWaypointsByCorpus at freeze time — a code override can
// never loosen the authorization floor.
//
// This file only stores/reads the **override layer itself** (not the inherited role's
// entries); the merge happens at snapshot assembly.

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

// SetWaypoints —— clear + insert code_waypoints one row at a time (empty slice
// = clears the override layer → fully inherits the role).
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

// Waypoints —— reads one code's override layer. Unconfigured → empty slice
// (equals fully inheriting the role once the caller merges it).
func (r *CodeRepo) Waypoints(ctx context.Context, codeID string) ([]entity.Waypoint, error) {
	codeUUID, perr := pgstore.ParseUUID(codeID)
	if perr != nil {
		return []entity.Waypoint{}, fmt.Errorf("parse code id: %w", perr)
	}
	return hydrateCodeWaypoints(ctx, db.New(r.pool), codeUUID)
}

// hydrateCodeWaypoints —— reads code_waypoints → domain (row mapping shares
// waypointsFromRows).
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
