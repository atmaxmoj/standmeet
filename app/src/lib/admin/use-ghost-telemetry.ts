// use-ghost-telemetry —— the per-waypoint ghost-steering funnel for the conversations section.
// GET /api/admin/ghosts/telemetry → { waypoints:[{target_waypoint, shown, accepted,
// acceptance_rate}], totals }. Owner-scoped over policy ghosts. Same resource-store pattern as
// use-conversations; the panel hides itself when there are no policy ghosts yet.

'use client';

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const WaypointStatSchema = z.object({
  target_waypoint: z.string(),
  shown: z.number(),
  accepted: z.number(),
  acceptance_rate: z.number(),
});

const TelemetrySchema = z.object({
  waypoints: z.array(WaypointStatSchema),
  totals: z.object({
    shown: z.number(),
    accepted: z.number(),
    acceptance_rate: z.number(),
  }),
});

export type WaypointStat = z.infer<typeof WaypointStatSchema>;
export type GhostTelemetry = z.infer<typeof TelemetrySchema>;

export const ghostTelemetryStore = createResourceStore<GhostTelemetry>({
  name: 'ghost-telemetry',
  fetcher: () => adminAPI.get('/ghosts/telemetry', TelemetrySchema),
});

export interface GhostTelemetryHook {
  status: ResourceStatus;
  data: GhostTelemetry | null;
  error: string | null;
}

export function useGhostTelemetry(): GhostTelemetryHook {
  const r = useResource(ghostTelemetryStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { status: r.status, data: r.data ?? null, error: r.error };
}

const ZERO_TOTALS = { shown: 0, accepted: 0, acceptance_rate: 0 };

// GhostTelemetryView —— derived render state so the panel stays `if`-free (presentation-layer rule):
// `visible` folds "loaded AND non-empty" here; the component just ternaries on it.
export interface GhostTelemetryView {
  visible: boolean;
  waypoints: readonly WaypointStat[];
  totals: GhostTelemetry['totals'];
}

export function useGhostTelemetryView(): GhostTelemetryView {
  const { data, status } = useGhostTelemetry();
  const ready = status !== 'idle' && status !== 'loading';
  const waypoints = data?.waypoints ?? [];
  return {
    visible: ready && waypoints.length > 0,
    waypoints,
    totals: data?.totals ?? ZERO_TOTALS,
  };
}

// pct —— fraction (0.5) → "50%". Rounded; the funnel is a glanceable rate, not a precise metric.
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
