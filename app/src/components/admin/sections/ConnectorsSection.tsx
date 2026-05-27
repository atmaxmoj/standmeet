// ConnectorsSection —— /admin/connectors。
//
// 设计源 docs/design/project/admin.js ConnectorsSection (2115-2179)。
// 顶部 "+ add connector" 按钮 + "N more available in catalog" 提示；
// 点开走 ConnectorAddModal → 分类 tab → 卡片 → ConnectorConfigForm
// 动态 render fields[]。加新 connector 只需要给 connector-registry 加
// 一条 entry（GCal booking 之后照此模板，不动 component code）。
//
// 已 install 的 connector 仍走老 toggle 列表（local state，无 backend）。

'use client';

import { useCallback, useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConnectorAddModal } from '@/components/admin/ConnectorAddModal';
import { ConnectorTile } from '@/components/admin/sections/connectors/ConnectorTile';
import { useConnectors, type ConnectorsHook } from '@/lib/admin/use-connectors';
import { catalogSize } from '@/lib/admin/connector-registry';

export function ConnectorsSection() {
  const hook = useConnectors();
  const [showAdd, setShowAdd] = useState(false);
  const installed = hook.connectors.filter((c) => c.connected).map((c) => c.id);
  const onConnect = useCallback((id: string, _values: Record<string, string>) => {
    // backend 未通：先把 tile 翻 on，让 UI 显示已装。GCal 真接通后这里
    // 走 POST /api/admin/connectors。
    hook.toggle(id);
  }, [hook]);
  return (
    <>
      <SectionHeader
        kicker="integrations"
        title="connectors"
        count={titleCount(hook)}
        action={<AddBtn onOpen={() => setShowAdd(true)} />}
      />
      <Intro />
      <Grid hook={hook} onBrowse={() => setShowAdd(true)} />
      {showAdd && (
        <ConnectorAddModal
          installed={installed}
          onClose={() => setShowAdd(false)}
          onConnect={onConnect}
        />
      )}
    </>
  );
}

function AddBtn({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="connector-add-open"
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      + add connector
    </button>
  );
}

function titleCount(hook: ConnectorsHook): string {
  const on = hook.connectors.filter((c) => c.connected).length;
  return `${on} installed · ${catalogSize()} in catalog`;
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Connectors pull from external sources (Gmail / Calendar / Slack) into your raw
      inbox, and let visitors chat with you from inside IM apps. Add new ones from the
      catalog; existing ones below can be toggled on/off.
    </p>
  );
}

function Grid({ hook, onBrowse }: { hook: ConnectorsHook; onBrowse: () => void }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {hook.connectors.map((c) => (
        <ConnectorTile key={c.id} connector={c} onToggle={() => hook.toggle(c.id)} />
      ))}
      <BrowseCatalogCard onClick={onBrowse} />
    </div>
  );
}

function BrowseCatalogCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="border border-dashed border-(--color-rule) rounded-[3px] flex flex-col items-center justify-center gap-1.5 p-6 cursor-pointer text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent) transition-colors bg-transparent"
    >
      <span className="mono text-[24px]">＋</span>
      <span className="mono text-[11px] tracking-[0.16em] uppercase">browse the catalog</span>
      <span className="mono text-[9.5px] tracking-[0.06em] text-(--color-faint)">
        {catalogSize()} types available
      </span>
    </button>
  );
}
