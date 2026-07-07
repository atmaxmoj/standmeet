// ConnectorsSection —— /admin/connectors。
//
// 真接通的:内置卡(CatalogCards ← /connectors/catalog:gcal/smtp…owner 填凭据 Connect)、
// owner 上传的 OpenAPI/protocol connector(ConnectorList + ConnectorAddModal 真走 POST
// /api/admin/connectors)、Calendar/Mail 专用面板、能力可用性面板。
// (旧的 "coming soon" catalog 预览网格已删 —— 不做 marketplace 目录,owner 上传即用。)

'use client';

import { useCallback, useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConnectorAddModal } from '@/components/admin/ConnectorAddModal';
import { CalendarConnectorPanel } from '@/components/admin/sections/connectors/CalendarConnectorPanel';
import { MailConnectorPanel } from '@/components/admin/sections/connectors/MailConnectorPanel';
import { CapabilitiesPanel } from '@/components/admin/sections/connectors/CapabilitiesPanel';
import { useConnectorList, type ConnectorListHook } from '@/lib/admin/use-connector-list';
import { useConnectorCatalog, type ConnectorCatalogHook } from '@/lib/admin/use-connector-catalog';
import { useConnectorUpload, type ConnectorUploadHook } from '@/lib/admin/use-connector-upload';
import { ConnectorList } from '@/components/admin/sections/connectors/ConnectorList';
import { ConnectorCard } from '@/components/admin/sections/connectors/ConnectorCard';

export function ConnectorsSection() {
  const list = useConnectorList();
  const catalog = useConnectorCatalog();
  const upload = useConnectorUpload(list);
  const [showAdd, setShowAdd] = useState(false);
  // AddModal 的内置-connect 回调:上传流不用它(走 onUpload),留 no-op 满足 prop。
  const onConnect = useCallback(() => {}, []);
  return (
    <>
      <SectionHeader
        kicker="integrations"
        title="connectors"
        count="calendar · mail live · upload your own"
        action={<AddBtn onOpen={() => setShowAdd(true)} />}
      />
      <Intro />
      {/* 模态打开时不渲染区内卡片/列表 —— 否则它们的 connector-connect-button/connector-status 会和
          模态里装配视图的同名 testid 撞上（装配测试用 page 级选择器）。 */}
      <SectionBody show={!showAdd} catalog={catalog} list={list} upload={upload} />
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
  show, catalog, list, upload,
}: {
  show: boolean;
  catalog: ConnectorCatalogHook;
  list: ConnectorListHook;
  upload: ConnectorUploadHook;
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
      + add connector
    </button>
  );
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Connectors let the agent reach external services — Calendar and Mail are live below,
      and you can upload your own (OpenAPI / protocol) connector to add more.
    </p>
  );
}
