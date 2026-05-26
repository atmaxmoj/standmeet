// ConnectorAddModal —— admin connectors "+ add" 模态。
// 分类 tab 过滤 catalog，点 connector tile 进入 ConnectorConfigForm。
//
// 设计源 docs/design/project/admin.js ConnectorAddModal (2053-2113)。
// installed: id[] 让 builtin / 已装的不弹"connect"。

'use client';

import { useState } from 'react';

import {
  CONNECTOR_CATEGORIES,
  catalogSize,
  connectorsByCategory,
  type ConnectorEntry,
} from '@/lib/admin/connector-registry';

import { ConnectorConfigForm } from '@/components/admin/ConnectorConfigForm';

interface Props {
  installed: readonly string[];
  onClose: () => void;
  onConnect: (id: string, values: Record<string, string>) => void;
}

export function ConnectorAddModal({ installed, onClose, onConnect }: Props) {
  const [cat, setCat] = useState(CONNECTOR_CATEGORIES[0]!.id);
  const [picked, setPicked] = useState<ConnectorEntry | null>(null);
  return (
    <ModalOverlay onClose={onClose}>
      <ModalHead onClose={onClose} />
      {picked === null
        ? <Catalog cat={cat} onCat={setCat} installed={installed} onPick={setPicked} />
        : <ConnectorConfigForm
            entry={picked}
            onCancel={() => setPicked(null)}
            onSave={(values) => { onConnect(picked.id, values); onClose(); }}
          />}
    </ModalOverlay>
  );
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
  return (
    <div className="sm-connector-modal-head">
      <div>
        <div className="sm-smallcaps">add connector · {catalogSize()} in catalog</div>
        <div className="sm-connector-modal-title">Extend the corpus surface.</div>
      </div>
      <button
        type="button" onClick={onClose}
        className="sm-btn sm-btn-ghost"
        data-testid="connector-modal-close"
      >
        close ✕
      </button>
    </div>
  );
}

function Catalog({
  cat, onCat, installed, onPick,
}: {
  cat: string;
  onCat: (id: string) => void;
  installed: readonly string[];
  onPick: (e: ConnectorEntry) => void;
}) {
  return (
    <div className="sm-connector-modal-body">
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
  return installed
    ? <span className="sm-pill is-accent"><span className="sm-dot-mark" />installed</span>
    : entry.builtin
      ? <span className="sm-pill"><span className="sm-dot-mark" />built-in</span>
      : null;
}
