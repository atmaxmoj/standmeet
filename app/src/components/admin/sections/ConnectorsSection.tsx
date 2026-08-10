// ConnectorsSection —— /admin/connectors。
//
// 真接通的:内置卡(CatalogCards ← /connectors/catalog:gcal/smtp…owner 填凭据 Connect)、
// owner 上传的 OpenAPI/protocol connector(ConnectorList + ConnectorAddModal 真走 POST
// /api/admin/connectors)、Calendar/Mail 专用面板、能力可用性面板。
// (旧的 "coming soon" catalog 预览网格已删 —— 不做 marketplace 目录,owner 上传即用。)

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConnectorAddModal } from '@/components/admin/ConnectorAddModal';
import { CalendarConnectorPanel } from '@/components/admin/sections/connectors/CalendarConnectorPanel';
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
  // modalOpen —— 有待回答的覆盖确认时,模态让位(那个确认渲染在区内主体里)。
  const modalOpen = showAdd && upload.pending === null;
  // openAdd —— 每次打开都从**干净的表单**开始。createdID 属于一次模态会话，不清的话摄入表单
  // 会一直让位给上一次装好的那张卡，spec 输入框永远不再出现 —— 装第二个连接器就此无门。
  const openAdd = useCallback(() => { upload.resetCreated(); setShowAdd(true); }, [upload]);
  // AddModal 的内置-connect 回调:上传流不用它(走 onAssemble),留 no-op 满足 prop。
  const onConnect = useCallback(() => {}, []);
  return (
    <>
      <SectionHeader
        kicker="integrations"
        title="connectors"
        count="calendar · mail live · upload your own"
        action={<AddBtn onOpen={openAdd} />}
      />
      <Intro />
      {/* 模态打开时不渲染区内卡片/列表 —— 否则它们的 connector-connect-button/connector-status 会和
          模态里装配视图的同名 testid 撞上（装配测试用 page 级选择器）。 */}
      {/* 模态在「有待回答的问题」时让位：覆盖确认渲染在区内主体里，模态盖着就问不出来。
          待回答的问题优先于模态。 */}
      <SectionBody show={!modalOpen} catalog={catalog} list={list} upload={upload} />
      {modalOpen && (
        <ConnectorAddModal
          installed={[]} onClose={() => setShowAdd(false)}
          onConnect={onConnect}
          // 装配之后**不关**模态：接着在同一处渲染新连接器的卡（凭据 + Connect）。
          // 关掉的话 owner 会落在一个连不上的列表行上 —— ConnectorList 的行没有 Connect。
          onAssemble={upload.upload}
          assemble={upload.state}
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
      {/* Mail is configured via the generic SMTP catalog card above; the old dedicated
          MailConnectorPanel was dead (F-C-3) and removed (F-B-1). Calendar keeps its own
          panel because it uniquely hosts the booking-policy editor. */}
      <div className="mb-8 max-w-[640px]">
        <CalendarConnectorPanel />
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
  const t = useTranslations('adminIntegrations.connectors');
  return show ? (
    <p data-testid="connector-catalog-error" className="mono text-[11px] text-(--color-accent)">
      {t('catalogError')}
    </p>
  ) : null;
}

function OverwriteConfirm({ hook }: { hook: ConnectorUploadHook }) {
  return hook.pending === null
    ? null
    : <OverwriteConfirmBody category={hook.pending.category} onConfirm={hook.confirmOverwrite} />;
}

function OverwriteConfirmBody({
  category, onConfirm,
}: { category: string; onConfirm: () => void }) {
  const t = useTranslations('adminIntegrations.connectors');
  return (
    <div className="mb-6 border border-(--color-accent)/50 rounded-sm p-3 bg-(--color-accent)/5">
      <p className="text-[13px] text-(--color-ink) mb-2">
        {t.rich('overwritePrompt', {
          category,
          mono: (chunks) => <span className="mono">{chunks}</span>,
        })}
      </p>
      <button
        type="button" onClick={onConfirm}
        data-testid="connector-overwrite-confirm"
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('overwrite')}
      </button>
    </div>
  );
}

function AddBtn({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('adminIntegrations.connectors');
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="connector-add-open"
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('add')}
    </button>
  );
}

function Intro() {
  const t = useTranslations('adminIntegrations.connectors');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('intro')}
    </p>
  );
}
