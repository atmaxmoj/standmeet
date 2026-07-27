// waypoint.go —— ghost-steering 的 waypoint 类型 + 它的代数（合并 / 校验 / 可行性过滤）。
//
// 从 role_snapshot.go 抽出来：snapshot 是"session 冻结的 role 状态"，waypoint 的合并规则
// （role ⊕ code）是独立主题，跟 corpus/skill/capability 的冻结逻辑无关。

package entity

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// Waypoint —— ghost-steering 的一个引导目的地（owner 写在 role 上,code 可继承/覆盖,
// 冻结进 RoleSnapshot）。字段顺序按 fieldalignment：两个 string 在前、slice 中、int/bool 末。
type Waypoint struct {
	WaypointID   string   `json:"waypoint_id"`
	Description  string   `json:"description"`
	EvidenceRefs []string `json:"evidence_refs"`
	Weight       int      `json:"weight"`
	IsTerminal   bool     `json:"is_terminal"`
}

// MergeWaypoints —— code 的 waypoints 叠在 role 的之上:同 waypoint_id → code 覆盖整条,
// 新 id → 追加。role 是「这个受众」的目的地,code 是「这一次邀约」的 —— 一张招聘码想给通用
// role 加一个只属于本次的目的地、或把某条的 weight 调高,不该被迫复制整份清单。
//
// 保留 role 顺序(稳定,便于 owner 对照),code 新增的接在后面。空 override → 原样返回 role 的。
//
// 这里**只做合并**:授权过滤仍由 FilterWaypointsByCorpus 在冻结那刻统一执行 —— code 永远
// 不能借覆盖把 role 看不见的证据引导出来(feasibility floor 不因 code 而松)。
func MergeWaypoints(base, override []Waypoint) []Waypoint {
	if len(override) == 0 {
		return base
	}
	byID := map[string]Waypoint{}
	for _, w := range override {
		byID[w.WaypointID] = w
	}
	ov := overlayOnto(base, byID)
	return append(ov.merged, newOverrides(override, ov.overriddenIDs)...)
}

// overlaid —— overlayOnto 的多返回打包（同 partitionedVault：避开 named return / result-limit）。
type overlaid struct {
	overriddenIDs map[string]bool // fieldalignment: map(1 ptr) 在前, slice(3 ptr) 在后
	merged        []Waypoint
}

// overlayOnto —— 走一遍 role 的清单：同 id 换成 code 那条，其余原样。
func overlayOnto(base []Waypoint, byID map[string]Waypoint) overlaid {
	out := make([]Waypoint, 0, len(base)+len(byID))
	overridden := map[string]bool{}
	for _, w := range base {
		if ov, ok := byID[w.WaypointID]; ok {
			out = append(out, ov)
			overridden[w.WaypointID] = true
			continue
		}
		out = append(out, w)
	}
	return overlaid{merged: out, overriddenIDs: overridden}
}

// newOverrides —— code 里 role 没有的那些（保持 code 内的书写顺序，接在后面）。
func newOverrides(override []Waypoint, overridden map[string]bool) []Waypoint {
	out := make([]Waypoint, 0, len(override))
	for _, w := range override {
		if !overridden[w.WaypointID] {
			out = append(out, w)
		}
	}
	return out
}

// ErrWaypointEmptyID —— waypoint_id 是合并(MergeWaypoints)、visited 标记(ledger)、
// ghost 归因的键；空了整套语义散架，所以它是唯一的硬性要求。
var ErrWaypointEmptyID = errors.New("each waypoint needs an id")

// ErrWaypointDuplicateID —— 同一份清单里 id 撞车 → 合并时无从判定谁覆盖谁。
var ErrWaypointDuplicateID = errors.New("waypoint ids must be unique")

// ValidateWaypoints —— owner 写入的 waypoint 形态校验（role 面 + code 覆盖面共用一条规则）。
// description/weight/evidence_refs 都可空：没证据的 waypoint 仍是合法目的地（FilterWaypointsByCorpus
// 放行它，prompt 的 EVIDENCE 规则再决定提不提），空 weight 就是 0 权重。
func ValidateWaypoints(ws []Waypoint) error {
	seen := map[string]bool{}
	for i := range ws {
		id := strings.TrimSpace(ws[i].WaypointID)
		if id == "" {
			return ErrWaypointEmptyID
		}
		if seen[id] {
			return fmt.Errorf("%w: %s", ErrWaypointDuplicateID, id)
		}
		seen[id] = true
	}
	return nil
}

// cloneWaypoints —— 深拷贝（evidence_refs slice 也 clone），防冻结后被改。
func cloneWaypoints(in []Waypoint) []Waypoint {
	if len(in) == 0 {
		return []Waypoint{}
	}
	out := make([]Waypoint, len(in))
	for i, w := range in {
		out[i] = w
		out[i].EvidenceRefs = slices.Clone(w.EvidenceRefs)
	}
	return out
}

// FilterWaypointsByCorpus —— feasibility floor（冻结时调）：丢弃 evidence_refs 全落在授权 glob
// 之外的 waypoint —— role 看不到的证据不该被引导向。无 refs 的 waypoint（如 booking 终点，靠工具
// 事件而非 corpus）保留；≥1 条 ref 在界内 → 保留整条（policy 侧只会引用可见的那些）。
func FilterWaypointsByCorpus(waypoints []Waypoint, granted []string) []Waypoint {
	out := make([]Waypoint, 0, len(waypoints))
	for _, w := range waypoints {
		if len(w.EvidenceRefs) == 0 || anyRefAllowed(granted, w.EvidenceRefs) {
			out = append(out, w)
		}
	}
	return out
}

func anyRefAllowed(granted, refs []string) bool {
	for _, ref := range refs {
		if MatchesAnyCorpusGlob(granted, ref) {
			return true
		}
	}
	return false
}
