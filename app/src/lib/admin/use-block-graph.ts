// use-block-graph —— the data layer for the fiber view: the block dependency graph
// (GET /api/admin/blocks/graph). Each node carries provides / requires and required_by (what
// relies on it — the reverse edge the relied-lock reads). Same createResourceStore shape as the
// other admin hooks.

'use client';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const GraphNodeSchema = z.object({
  id: z.string(),
  provides: z.string(),
  requires: z.array(z.string()),
  // required_by —— ids that rely on this block's provided seam. Optional so a surface that
  // predates the field still parses ([[zod-unknown-is-not-optional]]).
  required_by: z.array(z.string()).optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

const GraphRespSchema = z.object({ nodes: z.array(GraphNodeSchema) });

const graphStore = createResourceStore<GraphNode[]>({
  name: 'block-graph',
  fetcher: () => adminAPI.get('/blocks/graph', GraphRespSchema).then((r) => r.nodes),
});

export interface BlockGraphHook {
  nodes: readonly GraphNode[];
  status: ResourceStatus;
  ensureLoaded: () => Promise<void>;
}

export function useBlockGraph(): BlockGraphHook {
  const { data, status, ensureLoaded } = graphStore();
  return { nodes: data ?? [], status, ensureLoaded };
}

// mermaidNodeID —— a mermaid-safe id (letters/digits/underscore). Block ids carry dots
// (`calendar.book`), which mermaid would misparse; the real id is kept as the label.
function mermaidNodeID(id: string): string {
  return 'n_' + id.replace(/[^A-Za-z0-9]+/g, '_');
}

// mermaidSource —— a left-to-right flowchart of the dependency graph: an edge consumer → provider
// for every requires-seam some node provides. Every node is declared (so an unconnected block
// still shows), and each node's label is its real id. Pure, so the fiber view stays a thin render.
export function mermaidSource(nodes: readonly GraphNode[]): string {
  const provider = new Map<string, string>(); // seam → provider id
  for (const n of nodes) {
    if (n.provides) provider.set(n.provides, n.id);
  }
  const lines = ['graph LR'];
  for (const n of nodes) {
    lines.push(`  ${mermaidNodeID(n.id)}["${n.id}"]`);
  }
  for (const n of nodes) {
    for (const seam of n.requires) {
      const p = provider.get(seam);
      if (p) lines.push(`  ${mermaidNodeID(n.id)} --> ${mermaidNodeID(p)}`);
    }
  }
  return lines.join('\n');
}
