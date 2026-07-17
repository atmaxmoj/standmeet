// use-corpus-graph —— the admin TopBar constellation's data. GET /api/admin/stats/graph
// returns the owner's most-linked corpus notes (top-N by link degree, from note_refs).
// The node's size is its degree — more links, bigger node (the Obsidian-graph read).
// Read-only, loaded once on mount; sizing math lives here (lib), the strip stays branch-free.

'use client';

import { z } from 'zod';

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

const GraphNodeSchema = z.object({
  id: z.string(), title: z.string(), genre: z.string(), degree: z.number(),
});
export type CorpusGraphNode = z.infer<typeof GraphNodeSchema>;

const GraphSchema = z.object({ nodes: z.array(GraphNodeSchema) });

export const corpusGraphStore = createResourceStore<CorpusGraphNode[]>({
  name: 'corpus-graph',
  fetcher: () => adminAPI.get('/stats/graph?limit=18', GraphSchema).then((r) => r.nodes),
});

export function useCorpusGraph(): CorpusGraphNode[] {
  const r = useResource(corpusGraphStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return r.data ?? [];
}
