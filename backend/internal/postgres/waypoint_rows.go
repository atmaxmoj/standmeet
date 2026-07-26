// waypoint_rows.go —— role_waypoints / code_waypoints 两表**同构行**的唯一映射处。
//
// 两表字段一模一样（只有 owner 键不同：role_id vs code_id），所以行→domain 的映射
// （含 evidence_refs jsonb → []string）只准有一份。第一版是把 hydrateRoleWaypoints 复制了一遍，
// `dupl` 当场逮住 —— 而这正是 F-R-1 的病根（同一逻辑 4 份副本，改了 3 份，剩下那份继续漏 markup
// 给 owner 看）。一份实现，两边共用，drift 无处可生。

package postgres

import (
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access"
)

// waypointRow —— 两表共同的行形状（sqlc 给的是两个独立类型，字段却相同）。
type waypointRow struct {
	WaypointID   string
	Description  string
	EvidenceRefs []byte // jsonb
	Weight       int32
	IsTerminal   bool
}

// waypointsFromRows —— 同构行 → access.Waypoint，evidence_refs jsonb → []string。
func waypointsFromRows(rows []waypointRow) ([]access.Waypoint, error) {
	out := make([]access.Waypoint, 0, len(rows))
	for i := range rows {
		refs, err := decodeEvidenceRefs(rows[i].EvidenceRefs)
		if err != nil {
			return []access.Waypoint{}, err
		}
		out = append(out, access.Waypoint{
			WaypointID: rows[i].WaypointID, Description: rows[i].Description,
			Weight: int(rows[i].Weight), EvidenceRefs: refs, IsTerminal: rows[i].IsTerminal,
		})
	}
	return out, nil
}

// decodeEvidenceRefs —— jsonb → []string；空/NULL → 空 slice（no-nil-container）。
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
