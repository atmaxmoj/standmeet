// ProviderBookPanel —— /admin/api-mcp 上的 "provider book" 块。
//
// 上面那块("owner's ai")编的是**默认那一条**;这一块是本子本身:还有哪些条目、谁是默认、
// 删哪条。码和 role 的下拉里选的就是这里的条目。

'use client';

import { useTranslations } from 'next-intl';

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
      <h3 className="sm-section-h mb-3">
        {t('heading')}
      </h3>
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
