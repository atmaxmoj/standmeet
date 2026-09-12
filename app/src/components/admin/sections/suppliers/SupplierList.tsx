// SupplierList — suppliers the owner has configured (uploaded openapi + protocol), one row
// each: seam + status + origin badge (uploaded / built-in) + delete. The unified list
// (replaces a hand-rolled, gcal-specific card listed one at a time).
// Data comes from use-supplier-list (GET /api/admin/suppliers).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { SupplierCardBody } from '@/components/admin/sections/suppliers/SupplierCard';
import {
  originOf, type SupplierListHook, type SupplierRow,
} from '@/lib/admin/use-supplier-list';
import { useAction } from '@/lib/ui/use-action';

export function SupplierList({ hook }: { hook: SupplierListHook }) {
  const run = useAction();
  const t = useTranslations('adminIntegrations.suppliers');
  // Only lists owner-built (uploaded/protocol) suppliers; built-ins (configured gcal/smtp…)
  // are catalog cards and aren't re-rendered here — otherwise a configured built-in would show
  // up twice, as supplier-row-{id} (the card) and supplier-row-{seam} (this one),
  // colliding on testid.
  const uploaded = hook.suppliers.filter((c) => originOf(c) === 'uploaded');
  // Show the hint even when the list is empty if loadError is set: empty vs. "failed to load"
  // must stay distinguishable to the owner (§2, never collapse silently into empty).
  return (!hook.loadError && uploaded.length === 0) ? null : (
    <div className="mb-8 space-y-3">
      <AdminSectionHead className="mb-3" aside={t('uploadedCount', { count: String(uploaded.length) })}>
        {t('uploadedHeading')}
      </AdminSectionHead>
      <LoadError show={hook.loadError} />
      {uploaded.map((row) => (
        <SupplierRowItem
          key={row.id}
          row={row}
          onDelete={() => { void run(() => hook.remove(row.id), { success: t('removedToast') }); }}
        />
      ))}
    </div>
  );
}

// LoadError — hint shown when the list failed to load (§2: an empty list must read
// differently from a load failure).
function LoadError({ show }: { show: boolean }) {
  const t = useTranslations('adminIntegrations.supplierList');
  return show ? (
    <p data-testid="supplier-list-error" className="mono text-[11px] text-(--color-accent)">
      {t('loadError')}
    </p>
  ) : null;
}

// SupplierRowItem — the family the owner uploaded themselves. **Shares the same body as the
// built-in card** (`SupplierCardBody`): seam name and status are rendered by it, this
// file only adds the extra "origin / kind / delete" row on top.
//
// This used to have only that extra row, no credentials form, no CONNECT — you could upload
// it in but never connect it (F-C-47). Category name and status are **allowed only one
// place to render**: they used to each be drawn here too (`supplier-status` used to belong
// to this row), and once the body was shared, CardHead owns them — otherwise a second string
// would sit stacked on the same spot.
function SupplierRowItem({ row, onDelete }: { row: SupplierRow; onDelete: () => void }) {
  return (
    <li
      data-testid={`supplier-row-${row.seam}`}
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-4"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-center gap-2 mb-2">
        <OriginBadge row={row} />
        <span className="mono text-[10px] text-(--color-faint)">{row.kind}</span>
        <span className="ml-auto"><DeleteControl onDelete={onDelete} /></span>
      </div>
      <SupplierCardBody entry={row} />
    </li>
  );
}

function OriginBadge({ row }: { row: SupplierRow }) {
  // The "not connected" copy must avoid the "connected" substring (test uses
  // .not.toHaveText); origin similarly avoids the other's keyword.
  return (
    <span
      data-testid="supplier-origin-badge"
      className="inline-flex items-center px-1.5 py-0.5 border border-(--color-rule) rounded-sm mono text-[10px] lowercase"
    >
      {originOf(row)}
    </span>
  );
}

// DeleteControl — ✕ → confirm (two-step for a destructive action). The ✕'s accessible name is
// "✕" (doesn't match /delete|remove/, avoiding a strict-mode clash with the confirm button);
// the confirm button's "Delete" copy is what matches the test's getByRole(name:/delete/).
function DeleteControl({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const t = useTranslations('adminIntegrations.supplierList');
  const tc = useTranslations('adminIntegrations.common');
  return confirming ? (
    <button
      type="button" onClick={onDelete}
      className="shrink-0 sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('delete')}
    </button>
  ) : (
    <button
      type="button"
      data-testid="supplier-delete-button"
      aria-label={t('removeAria')}
      onClick={() => setConfirming(true)}
      className="shrink-0 mono text-[13px] text-(--color-muted) hover:text-(--color-accent) transition-colors"
    >
      {tc('close')}
    </button>
  );
}
