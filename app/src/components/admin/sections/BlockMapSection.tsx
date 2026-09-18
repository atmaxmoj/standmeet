// BlockMapSection —— the plugins group's block map: the composition drawn as a dependency graph.
//
// A block depends on another when it requires a seam that one provides; the map draws that graph
// so the owner sees the whole composition — including what relies on what (an edge INTO a node
// means something relies on it, which is what locks a block's Active toggle). It's a mermaid
// flowchart (the design's choice: the graph has shared nodes a chain/tree renderer can't draw),
// reusing the app's MermaidBlock. Data is blocks.graph (useBlockGraph); this stays a thin render.
//
// Node labels are the block ids themselves (data), so the view needs no per-locale strings beyond
// the nav title and the empty/error states.

'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { MermaidBlock } from '@/components/page/MermaidBlock';
import { useBlockGraph, mermaidSource, type GraphNode } from '@/lib/admin/use-block-graph';

export function BlockMapSection() {
  const { nodes, status, ensureLoaded } = useBlockGraph();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return (
    <>
      <SectionHeader slug="blockMap" />
      {status === 'error'
        ? <BlockMapMsg testid="block-map-error" k="error" />
        : <BlockMapGraph nodes={nodes} />}
    </>
  );
}

function BlockMapMsg({ testid, k }: { testid: string; k: 'error' | 'empty' }) {
  const t = useTranslations('adminIntegrations.blockMap');
  return <p data-testid={testid} className="mono text-[11px] text-(--color-muted)">{t(k)}</p>;
}

function BlockMapGraph({ nodes }: { nodes: readonly GraphNode[] }) {
  return nodes.length === 0
    ? <BlockMapMsg testid="block-map-empty" k="empty" />
    : (
      <div
        data-testid="block-map-graph"
        className="crosshair ch-tl ch-br p-4 bg-(--color-surface)"
      >
        <MermaidBlock source={mermaidSource(nodes)} />
      </div>
    );
}
