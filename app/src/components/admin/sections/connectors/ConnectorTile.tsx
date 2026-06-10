// ConnectorTile —— 单个 connector 卡(catalog 预览)。后端未接 → 全是 coming
// soon,不可连接、不假装 connected。Calendar(唯一真接通)走独立
// CalendarConnectorPanel,不在这张列表里。

import type { ConnectorView } from '@/lib/admin/use-connectors';

type Props = { connector: ConnectorView };

export function ConnectorTile({ connector }: Props) {
  return (
    <article
      className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30 flex flex-col"
      data-testid={`connector-tile-${connector.id}`}
    >
      <TileHead connector={connector} />
      <p className="reading-tight text-(--color-muted) mb-4 text-[14.5px]">{connector.note}</p>
      <TileFoot />
    </article>
  );
}

function TileHead({ connector }: { connector: ConnectorView }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h3 className="font-serif text-(--color-ink) text-[19px] font-medium">{connector.name}</h3>
      <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-faint)">
        ○ coming soon
      </span>
    </div>
  );
}

function TileFoot() {
  return (
    <div className="mt-auto pt-3 border-t border-(--color-rule)/60 flex items-baseline justify-between gap-3">
      <span className="mono text-[10.5px] tracking-[0.06em] text-(--color-faint)">not yet wired</span>
      <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-faint) border border-(--color-rule) px-2.5 py-1 cursor-default">
        soon
      </span>
    </div>
  );
}
