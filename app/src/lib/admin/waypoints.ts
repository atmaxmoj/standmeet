// waypoints.ts —— F-A-7 role 卡 waypoints 编辑器的纯逻辑(presentation 层禁 `if`,归 lib)。

import type { WaypointConfig } from '@/lib/admin/use-roles';

// blankWaypoint —— 新增一行的空 waypoint(weight 默认 1)。
export function blankWaypoint(): WaypointConfig {
  return { waypoint_id: '', description: '', evidence_refs: [], weight: 1, is_terminal: false };
}

// parseEvidence —— 逗号/换行分隔的 URI 串 → 去空去白的数组。
export function parseEvidence(raw: string): string[] {
  return raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s !== '');
}

// cleanWaypoints —— 存前丢掉没写 id 的空行(id 是 waypoint 的主键)。
export function cleanWaypoints(wps: readonly WaypointConfig[]): WaypointConfig[] {
  return wps.filter((w) => w.waypoint_id.trim() !== '')
    .map((w) => ({ ...w, waypoint_id: w.waypoint_id.trim() }));
}
