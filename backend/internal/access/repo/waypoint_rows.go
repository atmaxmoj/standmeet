// waypoint_rows.go —— the one place that maps the **structurally identical rows**
// of role_waypoints / code_waypoints.
//
// The two tables' fields are identical (only the owner key differs: role_id vs
// code_id), so the row→domain mapping (including evidence_refs jsonb → []string)
// is allowed to exist in exactly one place. The first version copied
// hydrateRoleWaypoints wholesale, and `dupl` caught it on the spot — which is
// exactly the root cause of F-R-1 (the same logic in 4 copies, 3 of them got
// fixed, the remaining one kept leaking raw markup to the owner). One
// implementation, shared by both sides, leaves nowhere for drift to happen.

package repo

import (
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

// waypointRow —— the row shape shared by both tables (sqlc generates two separate
// types, but their fields are the same).
type waypointRow struct {
	WaypointID   string
	Description  string
	EvidenceRefs []byte // jsonb
	Weight       int32
	IsTerminal   bool
}

// waypointsFromRows —— converts the shared row shape → Waypoint, decoding
// evidence_refs jsonb → []string.
func waypointsFromRows(rows []waypointRow) ([]entity.Waypoint, error) {
	out := make([]entity.Waypoint, 0, len(rows))
	for i := range rows {
		refs, err := decodeEvidenceRefs(rows[i].EvidenceRefs)
		if err != nil {
			return []entity.Waypoint{}, err
		}
		out = append(out, entity.Waypoint{
			WaypointID: rows[i].WaypointID, Description: rows[i].Description,
			Weight: int(rows[i].Weight), EvidenceRefs: refs, IsTerminal: rows[i].IsTerminal,
		})
	}
	return out, nil
}

// decodeEvidenceRefs —— jsonb → []string; empty/NULL → empty slice
// (no-nil-container).
func decodeEvidenceRefs(raw []byte) ([]string, error) {
	if len(raw) == 0 {
		return []string{}, nil
	}
	var refs []string
	if err := json.Unmarshal(raw, &refs); err != nil {
		return []string{}, fmt.Errorf("unmarshal evidence_refs: %w", err)
	}
	if refs == nil {
		return []string{}, nil
	}
	return refs, nil
}
