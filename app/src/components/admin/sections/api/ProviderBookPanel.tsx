// ProviderBookPanel — the "provider book" block on /admin/api-mcp.
//
// The block above ("owner's ai") edits **the default entry**; this block is
// the book itself: what other entries exist, which is default, which to
// delete. The entries picked in code and role dropdowns come from here.

'use client';

import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ProviderAddForm } from '@/components/admin/sections/api/ProviderAddForm';
import { ProviderBookRow } from '@/components/admin/sections/api/ProviderBookRow';
import { InlineSkeleton } from '@/components/skeletons/InlineSkeleton';
import { useProviders, type ProvidersHook } from '@/lib/admin/use-providers';
import { usePresets } from '@/lib/inference/use-presets';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function ProviderBookPanel() {
  const hook = useProviders();
  const t = useTranslations('adminIntegrations.providerBook');
  useEffectErrorToast(hook.error);
  return (
    <div data-testid="provider-book-panel">
      <AdminSectionHead className="mb-3">{t('heading')}</AdminSectionHead>
      <p className="reading-tight text-(--color-muted) text-[14.5px] max-w-[54em] mb-4">
        {t('intro')}
      </p>
      <Body hook={hook} />
    </div>
  );
}

function Body({ hook }: { hook: ProvidersHook }) {
  const presets = usePresets();
  const ready = hook.status === 'ready' && presets !== null;
  return ready
    ? (
      <>
        <List hook={hook} />
        <ProviderAddForm presets={presets} create={hook.createProvider} />
      </>
    )
    : <InlineSkeleton width="w-48" />;
}

function List({ hook }: { hook: ProvidersHook }) {
  const t = useTranslations('adminIntegrations.providerBook');
  return hook.providers.length === 0
    ? (
      <div data-testid="provider-list" className="sm-empty mono text-[11px] text-(--color-faint)">
        {t('empty')}
      </div>
    )
    : (
      <ul data-testid="provider-list">
        {hook.providers.map((p) => (
          <ProviderBookRow
            key={p.id} row={p}
            setDefault={hook.setDefaultProvider} remove={hook.deleteProvider}
            setGas={hook.setGas}
          />
        ))}
      </ul>
    );
}
