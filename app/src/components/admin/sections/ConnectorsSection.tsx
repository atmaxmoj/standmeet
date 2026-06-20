// ConnectorsSection —— /admin/connectors。
//
// 设计源 docs/design/project/admin.js ConnectorsSection。**Calendar 是唯一真
// 接通的**(独立 CalendarConnectorPanel)。其余(Gmail / Slack / Telegram /
// Discord)后端未接 —— catalog 预览,标 coming soon,**不假装 connected**。
// "+ add connector" 也只是 catalog 浏览,不会真 install(等后端接通再走 POST
// /api/admin/connectors)。

'use client';

import { useCallback, useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConnectorAddModal } from '@/components/admin/ConnectorAddModal';
import { ConnectorTile } from '@/components/admin/sections/connectors/ConnectorTile';
import { CalendarConnectorPanel } from '@/components/admin/sections/connectors/CalendarConnectorPanel';
import { MailConnectorPanel } from '@/components/admin/sections/connectors/MailConnectorPanel';
import { CapabilitiesPanel } from '@/components/admin/sections/connectors/CapabilitiesPanel';
import { useConnectors, type ConnectorsHook } from '@/lib/admin/use-connectors';
import { catalogSize } from '@/lib/admin/connector-registry';

export function ConnectorsSection() {
  const hook = useConnectors();
  const [showAdd, setShowAdd] = useState(false);
  // 后端未接 —— catalog 浏览不真 install(不写假 connected 状态)。
  const onConnect = useCallback(() => {}, []);
  return (
    <>
      <SectionHeader
        kicker="integrations"
        title="connectors"
        count={`calendar live · ${catalogSize()} more in catalog`}
        action={<AddBtn onOpen={() => setShowAdd(true)} />}
      />
      <Intro />
      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <CalendarConnectorPanel />
        <MailConnectorPanel />
      </div>
      <div className="mb-8">
        <CapabilitiesPanel />
      </div>
      <Grid hook={hook} onBrowse={() => setShowAdd(true)} />
      {showAdd && (
        <ConnectorAddModal installed={[]} onClose={() => setShowAdd(false)} onConnect={onConnect} />
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
      + browse catalog
    </button>
  );
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Connectors pull from external sources (Gmail / Slack) and let visitors chat from
      inside IM apps. Calendar is live below; the rest are on the way — this is a preview
      of what&rsquo;s coming, not yet wired.
    </p>
  );
}

function Grid({ hook, onBrowse }: { hook: ConnectorsHook; onBrowse: () => void }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {hook.connectors.map((c) => (
        <ConnectorTile key={c.id} connector={c} />
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
