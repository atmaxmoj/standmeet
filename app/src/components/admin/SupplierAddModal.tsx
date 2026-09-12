// SupplierAddModal —— the admin suppliers "+ add" modal.
// Category tabs filter the catalog; clicking a supplier tile opens SupplierConfigForm.
//
// Design source: docs/design/project/admin.js SupplierAddModal.
// installed: id[] keeps builtin / already-installed suppliers from offering "connect" again.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  SUPPLIER_CATEGORIES,
  catalogSize,
  suppliersByCategory,
  type SupplierEntry,
} from '@/lib/admin/supplier-registry';

import { SupplierConfigForm } from '@/components/admin/SupplierConfigForm';
import { SupplierSpecIngest } from '@/components/admin/SupplierSpecIngest';
import { ProtocolSupplierForm } from '@/components/admin/ProtocolSupplierForm';
import { AssembleView } from '@/components/admin/sections/suppliers/AssembleView';
import type { AssembleInput, AssembleState } from '@/lib/admin/use-supplier-upload';

interface Props {
  installed: readonly string[];
  onClose: () => void;
  onConnect: (id: string, values: Record<string, string>) => void;
  onAssemble: (input: AssembleInput) => void;
  // assemble —— the result of one assembly: when id is non-null, the form yields to that card
  // (credentials + Connect); when error is non-empty, the failure is shown inside the modal
  // (the modal covers the whole page, so a page-level toast wouldn't be seen by the owner).
  assemble: AssembleState;
}

export function SupplierAddModal(
  { installed, onClose, onConnect, onAssemble, assemble }: Props,
) {
  const [cat, setCat] = useState(SUPPLIER_CATEGORIES[0]!.id);
  const [picked, setPicked] = useState<SupplierEntry | null>(null);
  return (
    <ModalOverlay onClose={onClose}>
      <ModalHead onClose={onClose} />
      {picked === null
        ? <Catalog
            cat={cat} onCat={setCat} installed={installed}
            onPick={setPicked} onAssemble={onAssemble} assemble={assemble}
          />
        : <PickedView
            entry={picked} onBack={() => setPicked(null)} onAssemble={onAssemble}
            assemble={assemble}
            onConnect={(values) => { onConnect(picked.id, values); onClose(); }}
          />}
    </ModalOverlay>
  );
}

// PickedView —— a category-assembly card (assemble) goes through the unified AssembleView
// (OpenAPI upload or a built-in protocol); a protocol supplier (SMTP) goes through a fixed
// form + connection test; everything else goes through the generic catalog config form.
function PickedView({
  entry, onBack, onConnect, onAssemble, assemble,
}: {
  entry: SupplierEntry;
  onBack: () => void;
  onConnect: (v: Record<string, string>) => void;
  onAssemble: (input: AssembleInput) => void;
  assemble: AssembleState;
}) {
  return entry.assemble
    ? <AssembleView
        seam={entry.assembleSeam ?? ''}
        onAssemble={onAssemble} assemble={assemble}
      />
    : <NonAssembleView entry={entry} onBack={onBack} onConnect={onConnect} />;
}

function NonAssembleView({
  entry, onBack, onConnect,
}: { entry: SupplierEntry; onBack: () => void; onConnect: (v: Record<string, string>) => void }) {
  return (entry.protocol ?? '') === ''
    ? <SupplierConfigForm entry={entry} onCancel={onBack} onSave={onConnect} />
    : <ProtocolSupplierForm entry={entry} onClose={onBack} />;
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="sm-fadein sm-supplier-modal-overlay" onClick={onClose}>
      <div
        className="sm-supplier-modal-card sm-rise"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHead({ onClose }: { onClose: () => void }) {
  const t = useTranslations('adminShell.supplierAdd');
  return (
    <div className="sm-supplier-modal-head">
      <div>
        <div className="sm-smallcaps">{t('catalogCount', { n: catalogSize() })}</div>
        <div className="sm-supplier-modal-title">{t('tagline')}</div>
      </div>
      <button
        type="button" onClick={onClose}
        className="sm-btn sm-btn-ghost"
        data-testid="supplier-modal-close"
      >
        {t('close')}
      </button>
    </div>
  );
}

function Catalog({
  cat, onCat, installed, onPick, onAssemble, assemble,
}: {
  cat: string;
  onCat: (id: string) => void;
  installed: readonly string[];
  onPick: (e: SupplierEntry) => void;
  onAssemble: (input: AssembleInput) => void;
  assemble: AssembleState;
}) {
  return (
    <div className="sm-supplier-modal-body">
      <SupplierSpecIngest onAssemble={onAssemble} assemble={assemble} />
      <CategoryTabs cat={cat} onCat={onCat} />
      <CategoryBlurb cat={cat} />
      <SupplierGrid cat={cat} installed={installed} onPick={onPick} />
    </div>
  );
}

function CategoryTabs({ cat, onCat }: { cat: string; onCat: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {SUPPLIER_CATEGORIES.map((c) => (
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
  const blurb = SUPPLIER_CATEGORIES.find((c) => c.id === cat)?.blurb ?? '';
  return (
    <p className="sm-reading text-(--color-muted) text-[14px] mb-5">{blurb}</p>
  );
}

function SupplierGrid({
  cat, installed, onPick,
}: {
  cat: string;
  installed: readonly string[];
  onPick: (e: SupplierEntry) => void;
}) {
  const entries = suppliersByCategory(cat);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {entries.map((e) => (
        <SupplierTypeCard
          key={e.id} entry={e}
          installed={installed.includes(e.id)}
          onPick={() => onPick(e)}
        />
      ))}
    </div>
  );
}

function SupplierTypeCard({
  entry, installed, onPick,
}: { entry: SupplierEntry; installed: boolean; onPick: () => void }) {
  return (
    <button
      type="button" onClick={onPick}
      disabled={installed}
      data-testid={`supplier-card-${entry.id}`}
      className="sm-supplier-card text-left"
    >
      <CardHead entry={entry} installed={installed} />
      <p className="sm-reading text-(--color-muted) text-[13.5px] mt-1.5">{entry.blurb}</p>
    </button>
  );
}

function CardHead({ entry, installed }: { entry: SupplierEntry; installed: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="sm-supplier-card-icon">{entry.icon}</span>
      <span className="sm-supplier-card-name">{entry.name}</span>
      <CardBadge entry={entry} installed={installed} />
    </div>
  );
}

function CardBadge({ entry, installed }: { entry: SupplierEntry; installed: boolean }) {
  const t = useTranslations('adminShell.supplierAdd');
  return installed
    ? <span className="sm-pill is-accent"><span className="sm-dot-mark" />{t('installed')}</span>
    : entry.builtin
      ? <span className="sm-pill"><span className="sm-dot-mark" />{t('builtIn')}</span>
      : null;
}
