// SuppliersSection —— /admin/suppliers.
//
// What's really wired: built-in cards (CatalogCards ← /suppliers/catalog: gcal/smtp…
// owner fills credentials and hits Connect), suppliers the owner uploads as
// OpenAPI/protocol supplier (SupplierList + SupplierAddModal, a real POST to
// /api/admin/suppliers), the Calendar/Mail-specific panels, the block
// availability panel.
// (The old "coming soon" catalog preview grid is removed — no marketplace catalog;
// the owner just uploads and it's live.)

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { SupplierAddModal } from '@/components/admin/SupplierAddModal';
import { CalendarSupplierPanel } from '@/components/admin/sections/suppliers/CalendarSupplierPanel';
import { BundlePanel } from '@/components/admin/sections/suppliers/BundlePanel';
import { BlocksPanel } from '@/components/admin/sections/suppliers/BlocksPanel';
import { useSupplierList, type SupplierListHook } from '@/lib/admin/use-supplier-list';
import { useSupplierCatalog, type SupplierCatalogHook } from '@/lib/admin/use-supplier-catalog';
import { useSupplierUpload, type SupplierUploadHook } from '@/lib/admin/use-supplier-upload';
import { SupplierList } from '@/components/admin/sections/suppliers/SupplierList';
import { SupplierCard } from '@/components/admin/sections/suppliers/SupplierCard';

export function SuppliersSection() {
  const list = useSupplierList();
  const catalog = useSupplierCatalog();
  const upload = useSupplierUpload(list);
  const [showAdd, setShowAdd] = useState(false);
  // modalOpen —— when an overwrite confirmation is pending, the modal steps aside
  // (that confirmation renders in the section body).
  const modalOpen = showAdd && upload.pending === null;
  // openAdd —— every open starts from a **clean form**. createdID belongs to one modal
  // session; if it isn't cleared, the ingest form keeps deferring to the previously
  // assembled card and the spec input never reappears — installing a second supplier
  // becomes impossible.
  const openAdd = useCallback(() => { upload.resetCreated(); setShowAdd(true); }, [upload]);
  // AddModal's built-in-connect callback: the upload flow doesn't use it (it goes
  // through onAssemble); kept as a no-op to satisfy the prop.
  const onConnect = useCallback(() => {}, []);
  const t = useTranslations('adminIntegrations.suppliers');
  return (
    <>
      <SectionHeader
        kicker={t('kicker')}
        slug="suppliers"
        count={t('count')}
        action={<AddBtn onOpen={openAdd} />}
      />
      <Intro />
      {/* Don't render the section's cards/list while the modal is open — otherwise
          their supplier-connect-button/supplier-status testids collide with the
          same-named ones in the modal's assembly view (assembly tests use page-level
          selectors). */}
      {/* The modal steps aside when there's a pending question: the overwrite
          confirmation renders in the section body, and the modal on top would block
          it from being answered. A pending question takes priority over the modal. */}
      <SectionBody show={!modalOpen} catalog={catalog} list={list} upload={upload} />
      {modalOpen && (
        <SupplierAddModal
          installed={[]} onClose={() => setShowAdd(false)}
          onConnect={onConnect}
          // After assembly, **don't close** the modal: it goes on to render the new
          // supplier's card (credentials + Connect) in the same place. Closing it
          // would leave the owner on a list row that can't connect — SupplierList
          // rows have no Connect action.
          onAssemble={upload.upload}
          assemble={upload.state}
        />
      )}
    </>
  );
}

// SectionBody —— the suppliers section body (built-in cards + configured list +
// panels). Doesn't render at all while the modal is open (avoids testid collisions).
function SectionBody({
  show, catalog, list, upload,
}: {
  show: boolean;
  catalog: SupplierCatalogHook;
  list: SupplierListHook;
  upload: SupplierUploadHook;
}) {
  return show ? (
    <>
      <CatalogCards catalog={catalog} />
      <SupplierList hook={list} />
      <OverwriteConfirm hook={upload} />
      {/* Mail is configured via the generic SMTP catalog card above; the old dedicated
          mail panel was dead (F-C-3) and removed (F-B-1). Calendar keeps its own
          panel because it uniquely hosts the booking-policy editor. */}
      <div className="mb-8 max-w-[640px]">
        <CalendarSupplierPanel />
      </div>
      <div className="mb-8">
        <BlocksPanel />
      </div>
      {/* Install and assemble. `frontend.md` merges the bespoke panels above into one
          block list; this is the half of that which exists — the owner adds a block
          and groups blocks into bundles without any of it costing frontend code. */}
      <div className="mb-8">
        <BundlePanel />
      </div>
    </>
  ) : null;
}

// CatalogCards —— one normalized card per built-in supplier (assembled externally);
// the owner fills credentials + Connect right in the card.
function CatalogCards({ catalog }: { catalog: SupplierCatalogHook }) {
  const t = useTranslations('adminIntegrations.suppliers');
  // Show a notice on loadError even when the entries list is empty: empty vs.
  // "failed to load" must stay distinguishable (§2 — never fail silently into empty).
  return (!catalog.loadError && catalog.entries.length === 0) ? null : (
    <div className="mb-8 space-y-3">
      {/* This block of cards used to start right under the intro with no boundary
          from the owner's own uploaded list below — so "built-in" and "what I
          uploaded" read as one thing on the page (UX-79). */}
      <AdminSectionHead className="mb-3" aside={t('builtinCount', { count: String(catalog.entries.length) })}>
        {t('builtinHeading')}
      </AdminSectionHead>
      <CatalogLoadError show={catalog.loadError} />
      {catalog.entries.map((entry) => (
        <SupplierCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

// CatalogLoadError —— the notice shown when the catalog failed to load (§2: empty
// vs. failed-to-load must stay distinguishable).
function CatalogLoadError({ show }: { show: boolean }) {
  const t = useTranslations('adminIntegrations.suppliers');
  return show ? (
    <p data-testid="supplier-catalog-error" className="mono text-[11px] text-(--color-accent)">
      {t('catalogError')}
    </p>
  ) : null;
}

function OverwriteConfirm({ hook }: { hook: SupplierUploadHook }) {
  return hook.pending === null
    ? null
    : <OverwriteConfirmBody seam={hook.pending.seam} onConfirm={hook.confirmOverwrite} />;
}

function OverwriteConfirmBody({
  seam, onConfirm,
}: { seam: string; onConfirm: () => void }) {
  const t = useTranslations('adminIntegrations.suppliers');
  return (
    <div className="mb-6 border border-(--color-accent)/50 rounded-sm p-3 bg-(--color-accent)/5">
      <p className="text-[13px] text-(--color-ink) mb-2">
        {t.rich('overwritePrompt', {
          seam,
          mono: (chunks) => <span className="mono">{chunks}</span>,
        })}
      </p>
      <button
        type="button" onClick={onConfirm}
        data-testid="supplier-overwrite-confirm"
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('overwrite')}
      </button>
    </div>
  );
}

function AddBtn({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('adminIntegrations.suppliers');
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="supplier-add-open"
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('add')}
    </button>
  );
}

function Intro() {
  const t = useTranslations('adminIntegrations.suppliers');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('intro')}
    </p>
  );
}
