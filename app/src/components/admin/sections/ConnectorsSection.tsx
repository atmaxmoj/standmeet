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
import { useConnectorList, type ConnectorListHook } from '@/lib/admin/use-connector-list';
import { useConnectorCatalog, type ConnectorCatalogHook } from '@/lib/admin/use-connector-catalog';
import { useConnectorUpload, type ConnectorUploadHook } from '@/lib/admin/use-connector-upload';
import { ConnectorList } from '@/components/admin/sections/connectors/ConnectorList';
import { ConnectorCard } from '@/components/admin/sections/connectors/ConnectorCard';
import { catalogSize } from '@/lib/admin/connector-registry';

export function ConnectorsSection() {
  const hook = useConnectors();
  const list = useConnectorList();
  const catalog = useConnectorCatalog();
  const upload = useConnectorUpload(list);
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
      {/* 模态打开时不渲染区内卡片/列表 —— 否则它们的 connector-connect-button/connector-status 会和
          模态里装配视图的同名 testid 撞上（装配测试用 page 级选择器）。 */}
      <SectionBody
        show={!showAdd} catalog={catalog} list={list} upload={upload} hook={hook}
        onBrowse={() => setShowAdd(true)}
      />
      {showAdd && (
        <ConnectorAddModal
          installed={[]} onClose={() => setShowAdd(false)}
          onConnect={onConnect}
          onUpload={(s, b) => { upload.upload(s, b); setShowAdd(false); }}
        />
      )}
    </>
  );
}

// SectionBody —— connectors 区主体（内置卡 + 已配列表 + 面板）。模态开时整体不渲染（避免 testid 撞）。
function SectionBody({
  show, catalog, list, upload, hook, onBrowse,
}: {
  show: boolean;
  catalog: ConnectorCatalogHook;
  list: ConnectorListHook;
  upload: ConnectorUploadHook;
  hook: ConnectorsHook;
  onBrowse: () => void;
}) {
  return show ? (
    <>
      <CatalogCards catalog={catalog} />
      <ConnectorList hook={list} />
      <OverwriteConfirm hook={upload} />
      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <CalendarConnectorPanel />
        <MailConnectorPanel />
      </div>
      <div className="mb-8">
        <CapabilitiesPanel />
      </div>
      <Grid hook={hook} onBrowse={onBrowse} />
    </>
  ) : null;
}

// CatalogCards —— 内置连接器（外置装配进来的）各一张归一卡，owner 在卡里填凭据 + Connect。
function CatalogCards({ catalog }: { catalog: ConnectorCatalogHook }) {
  // loadError 时哪怕空也要出提示：空 vs「没拉到」得分得清（§2 不静默成空）。
  return (!catalog.loadError && catalog.entries.length === 0) ? null : (
    <div className="mb-8 space-y-3">
      <CatalogLoadError show={catalog.loadError} />
      {catalog.entries.map((entry) => (
        <ConnectorCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

// CatalogLoadError —— 目录没拉到时的提示（§2：空 vs 加载失败要分得清）。
function CatalogLoadError({ show }: { show: boolean }) {
  return show ? (
    <p data-testid="connector-catalog-error" className="mono text-[11px] text-(--color-accent)">
      Couldn’t load the connector catalog — reload and retry.
    </p>
  ) : null;
}

function OverwriteConfirm({ hook }: { hook: ConnectorUploadHook }) {
  return hook.pending === null ? null : (
    <div className="mb-6 border border-(--color-accent)/50 rounded-sm p-3 bg-(--color-accent)/5">
      <p className="text-[13px] text-(--color-ink) mb-2">
        A <span className="mono">{hook.pending.category}</span> connector already exists. Overwrite it?
      </p>
      <button
        type="button" onClick={hook.confirmOverwrite}
        data-testid="connector-overwrite-confirm"
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        Overwrite
      </button>
    </div>
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
