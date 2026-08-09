// ConnectorAddModal —— admin connectors "+ add" 模态。
// 分类 tab 过滤 catalog，点 connector tile 进入 ConnectorConfigForm。
//
// 设计源 docs/design/project/admin.js ConnectorAddModal。
// installed: id[] 让 builtin / 已装的不弹"connect"。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  CONNECTOR_CATEGORIES,
  catalogSize,
  connectorsByCategory,
  type ConnectorEntry,
} from '@/lib/admin/connector-registry';

import { ConnectorConfigForm } from '@/components/admin/ConnectorConfigForm';
import { ConnectorSpecIngest } from '@/components/admin/ConnectorSpecIngest';
import { ProtocolConnectorForm } from '@/components/admin/ProtocolConnectorForm';
import { AssembleView } from '@/components/admin/sections/connectors/AssembleView';
import type { AssembleInput } from '@/lib/admin/use-connector-upload';

interface Props {
  installed: readonly string[];
  onClose: () => void;
  onConnect: (id: string, values: Record<string, string>) => void;
  onAssemble: (input: AssembleInput) => void;
  // assembledID —— 刚装配出来的连接器；非 null 时表单让位给它的卡（凭据 + Connect）。
  assembledID: string | null;
}

export function ConnectorAddModal(
  { installed, onClose, onConnect, onAssemble, assembledID }: Props,
) {
  const [cat, setCat] = useState(CONNECTOR_CATEGORIES[0]!.id);
  const [picked, setPicked] = useState<ConnectorEntry | null>(null);
  return (
    <ModalOverlay onClose={onClose}>
      <ModalHead onClose={onClose} />
      {picked === null
        ? <Catalog
            cat={cat} onCat={setCat} installed={installed}
            onPick={setPicked} onAssemble={onAssemble} assembledID={assembledID}
          />
        : <PickedView
            entry={picked} onBack={() => setPicked(null)} onAssemble={onAssemble}
            assembledID={assembledID}
            onConnect={(values) => { onConnect(picked.id, values); onClose(); }}
          />}
    </ModalOverlay>
  );
}

// PickedView —— 品类装配卡（assemble）走归一 AssembleView（OpenAPI 上传 或 内置协议）；protocol
// 连接器（SMTP）走固定表单 + 连接测试；其余走通用 catalog 配置表单。
function PickedView({
  entry, onBack, onConnect, onAssemble, assembledID,
}: {
  entry: ConnectorEntry;
  onBack: () => void;
  onConnect: (v: Record<string, string>) => void;
  onAssemble: (input: AssembleInput) => void;
  assembledID: string | null;
}) {
  return entry.assemble
    ? <AssembleView
        category={entry.assembleCategory ?? ''}
        onAssemble={onAssemble} assembledID={assembledID}
      />
    : <NonAssembleView entry={entry} onBack={onBack} onConnect={onConnect} />;
}

function NonAssembleView({
  entry, onBack, onConnect,
}: { entry: ConnectorEntry; onBack: () => void; onConnect: (v: Record<string, string>) => void }) {
  return (entry.protocol ?? '') === ''
    ? <ConnectorConfigForm entry={entry} onCancel={onBack} onSave={onConnect} />
    : <ProtocolConnectorForm entry={entry} onClose={onBack} />;
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="sm-fadein sm-connector-modal-overlay" onClick={onClose}>
      <div
        className="sm-connector-modal-card sm-rise"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHead({ onClose }: { onClose: () => void }) {
  const t = useTranslations('adminShell.connectorAdd');
  return (
    <div className="sm-connector-modal-head">
      <div>
        <div className="sm-smallcaps">{t('catalogCount', { n: catalogSize() })}</div>
        <div className="sm-connector-modal-title">{t('tagline')}</div>
      </div>
      <button
        type="button" onClick={onClose}
        className="sm-btn sm-btn-ghost"
        data-testid="connector-modal-close"
      >
        {t('close')}
      </button>
    </div>
  );
}

function Catalog({
  cat, onCat, installed, onPick, onAssemble, assembledID,
}: {
  cat: string;
  onCat: (id: string) => void;
  installed: readonly string[];
  onPick: (e: ConnectorEntry) => void;
  onAssemble: (input: AssembleInput) => void;
  assembledID: string | null;
}) {
  return (
    <div className="sm-connector-modal-body">
      <ConnectorSpecIngest onAssemble={onAssemble} assembledID={assembledID} />
      <CategoryTabs cat={cat} onCat={onCat} />
      <CategoryBlurb cat={cat} />
      <ConnectorGrid cat={cat} installed={installed} onPick={onPick} />
    </div>
  );
}

function CategoryTabs({ cat, onCat }: { cat: string; onCat: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {CONNECTOR_CATEGORIES.map((c) => (
        <button
          key={c.id} type="button" onClick={() => onCat(c.id)}
          className={`sm-chip is-clickable ${cat === c.id ? 'is-active' : ''}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function CategoryBlurb({ cat }: { cat: string }) {
  const blurb = CONNECTOR_CATEGORIES.find((c) => c.id === cat)?.blurb ?? '';
  return (
    <p className="sm-reading text-(--color-muted) text-[14px] mb-5">{blurb}</p>
  );
}

function ConnectorGrid({
  cat, installed, onPick,
}: {
  cat: string;
  installed: readonly string[];
  onPick: (e: ConnectorEntry) => void;
}) {
  const entries = connectorsByCategory(cat);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {entries.map((e) => (
        <ConnectorTypeCard
          key={e.id} entry={e}
          installed={installed.includes(e.id)}
          onPick={() => onPick(e)}
        />
      ))}
    </div>
  );
}

function ConnectorTypeCard({
  entry, installed, onPick,
}: { entry: ConnectorEntry; installed: boolean; onPick: () => void }) {
  return (
    <button
      type="button" onClick={onPick}
      disabled={installed}
      data-testid={`connector-card-${entry.id}`}
      className="sm-connector-card text-left"
    >
      <CardHead entry={entry} installed={installed} />
      <p className="sm-reading text-(--color-muted) text-[13.5px] mt-1.5">{entry.blurb}</p>
    </button>
  );
}

function CardHead({ entry, installed }: { entry: ConnectorEntry; installed: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="sm-connector-card-icon">{entry.icon}</span>
      <span className="sm-connector-card-name">{entry.name}</span>
      <CardBadge entry={entry} installed={installed} />
    </div>
  );
}

function CardBadge({ entry, installed }: { entry: ConnectorEntry; installed: boolean }) {
  const t = useTranslations('adminShell.connectorAdd');
  return installed
    ? <span className="sm-pill is-accent"><span className="sm-dot-mark" />{t('installed')}</span>
    : entry.builtin
      ? <span className="sm-pill"><span className="sm-dot-mark" />{t('builtIn')}</span>
      : null;
}
