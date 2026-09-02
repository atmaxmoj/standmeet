// waypoints.ts —— F-A-7 pure logic for the role card's waypoints editor
// (the presentation layer bans `if`, so this lives in lib).

import type { WaypointConfig } from '@/lib/admin/use-roles';

// blankWaypoint —— an empty waypoint for a newly added row (weight defaults to 1).
export function blankWaypoint(): WaypointConfig {
  return { waypoint_id: '', description: '', evidence_refs: [], weight: 1, is_terminal: false };
}

// parseEvidence —— comma/newline-separated URI string → array with blanks and whitespace stripped.
export function parseEvidence(raw: string): string[] {
  return raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s !== '');
}

// cleanWaypoints —— drop rows with no id before saving (id is the waypoint's primary key).
export function cleanWaypoints(wps: readonly WaypointConfig[]): WaypointConfig[] {
  return wps.filter((w) => w.waypoint_id.trim() !== '')
    .map((w) => ({ ...w, waypoint_id: w.waypoint_id.trim() }));
}
